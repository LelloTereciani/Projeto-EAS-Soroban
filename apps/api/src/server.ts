import crypto from 'node:crypto';
import Fastify from 'fastify';
import { Keypair } from '@stellar/stellar-sdk';
import type pg from 'pg';
import { z } from 'zod';
import type { Env } from './env.js';
import { EasSoroban } from './soroban.js';
import { sha256Bytes32 } from './soroban.js';

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function sha256HexFromJson(value: unknown) {
  const json = stableStringify(value);
  return crypto.createHash('sha256').update(json).digest('hex');
}

function jsonSafe(value: any): any {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v);
    return out;
  }
  return value;
}

export function buildServer(env: Env, db: pg.Pool, soroban: EasSoroban) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL
    }
  });

  app.get('/healthz', async () => ({ ok: true }));

  app.get('/schemas', async () => {
    const res = await db.query('SELECT * FROM schemas ORDER BY created_ledger DESC');
    return { schemas: res.rows };
  });

  app.get('/schemas/:schemaId', async (req, reply) => {
    const schemaId = (req.params as any).schemaId as string;
    const res = await db.query('SELECT * FROM schemas WHERE schema_id=$1', [schemaId]);
    if (res.rowCount === 0) return reply.code(404).send({ error: 'schema_not_found' });
    return res.rows[0];
  });

  app.get('/attestations/:attestationId', async (req, reply) => {
    const attestationId = (req.params as any).attestationId as string;
    const res = await db.query('SELECT * FROM attestations WHERE attestation_id=$1', [attestationId]);
    if (res.rowCount === 0) return reply.code(404).send({ error: 'attestation_not_found' });
    return res.rows[0];
  });

  app.get('/subjects/:address/attestations', async (req) => {
    const address = (req.params as any).address as string;
    const res = await db.query(
      'SELECT * FROM attestations WHERE subject=$1 ORDER BY timestamp DESC',
      [address]
    );
    return { attestations: res.rows };
  });

  app.post('/schemas', async (req, reply) => {
    if (!env.EAS_SCHEMA_CREATOR_SECRET) {
      return reply.code(500).send({ error: 'missing_EAS_SCHEMA_CREATOR_SECRET' });
    }

    const bodySchema = z.object({
      schemaUri: z.string().min(1),
      revocable: z.boolean().default(true),
      expiresAllowed: z.boolean().default(false),
      attesterMode: z.number().int().min(0).max(1).default(0)
    });

    const body = bodySchema.parse(req.body);

    const schemaUriHashHex = sha256Bytes32(body.schemaUri).toString('hex');
    const schemaId = schemaUriHashHex; // MVP: schema_id == schema_uri_hash

    // If the schema already exists, behave idempotently (contract panics on duplicates).
    const existing = await db.query('SELECT schema_id, schema_uri_hash FROM schemas WHERE schema_id=$1 LIMIT 1', [schemaId]);
    if (existing.rowCount && existing.rows[0]) {
      return { schemaId: existing.rows[0].schema_id, schemaUriHash: existing.rows[0].schema_uri_hash, existed: true };
    }

    let schemaUriHash = schemaUriHashHex;
    try {
      const out = await soroban.createSchema(env.EAS_SCHEMA_CREATOR_SECRET, body.schemaUri, {
        revocable: body.revocable,
        expiresAllowed: body.expiresAllowed,
        attesterMode: body.attesterMode
      });
      schemaUriHash = out.schemaUriHash;
    } catch (e: any) {
      // If on-chain says "already exists", the DB will usually already have it (API best-effort insert or indexer).
      const maybe = await db.query('SELECT schema_id, schema_uri_hash FROM schemas WHERE schema_id=$1 LIMIT 1', [schemaId]);
      if (maybe.rowCount && maybe.rows[0]) {
        return { schemaId: maybe.rows[0].schema_id, schemaUriHash: maybe.rows[0].schema_uri_hash, existed: true };
      }
      // Keep the underlying message to help debugging (no secrets included).
      return reply.code(502).send({ error: 'create_schema_failed', message: String(e?.message ?? e) });
    }

    // Best-effort insert (indexer will also catch it).
    await db.query(
      `INSERT INTO schemas(schema_id, creator, schema_uri_hash, revocable, expires_allowed, attester_mode, created_ledger)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(schema_id) DO NOTHING`,
      [
        schemaId,
        'api',
        schemaUriHash,
        body.revocable,
        body.expiresAllowed,
        body.attesterMode,
        '0'
      ]
    );

    return { schemaId, schemaUriHash };
  });

  app.post('/attestations', async (req, reply) => {
    if (!env.EAS_ATTESTER_SECRET) {
      return reply.code(500).send({ error: 'missing_EAS_ATTESTER_SECRET' });
    }
    if (!env.EAS_SCHEMA_CREATOR_SECRET) {
      return reply.code(500).send({ error: 'missing_EAS_SCHEMA_CREATOR_SECRET' });
    }

    const bodySchema = z.object({
      schemaId: z.string().regex(/^[0-9a-fA-F]{64}$/),
      subject: z.string().min(1),
      payload: z.any(),
      expirationLedger: z.number().int().positive().nullable().default(null)
    });

    const body = bodySchema.parse(req.body);

    const dataHashHex = sha256HexFromJson(body.payload);

    // Nonce lives on-chain; fetch and increment.
    const attesterPub = Keypair.fromSecret(env.EAS_ATTESTER_SECRET).publicKey();
    const sourcePub = Keypair.fromSecret(env.EAS_SCHEMA_CREATOR_SECRET).publicKey();

    const current = await soroban.getNonce(sourcePub, attesterPub);
    const next = current + 1n;

    const { attestationId } = await soroban.attest(env.EAS_ATTESTER_SECRET, {
      schemaIdHex: body.schemaId.toLowerCase(),
      subject: body.subject,
      dataHashHex,
      expirationLedger: body.expirationLedger,
      nonce: next
    });

    await db.query(
      `INSERT INTO attestations(attestation_id, schema_id, attester, subject, data_hash, payload_json, timestamp, expiration)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(attestation_id) DO NOTHING`,
      [
        attestationId,
        body.schemaId.toLowerCase(),
        attesterPub,
        body.subject,
        dataHashHex,
        body.payload,
        '0',
        body.expirationLedger
      ]
    );

    return { attestationId, dataHash: dataHashHex, nonce: next.toString() };
  });

  app.post('/attestations/:attestationId/revoke', async (req, reply) => {
    if (!env.EAS_ATTESTER_SECRET) {
      return reply.code(500).send({ error: 'missing_EAS_ATTESTER_SECRET' });
    }

    const attestationId = (req.params as any).attestationId as string;
    if (!/^[0-9a-fA-F]{64}$/.test(attestationId)) {
      return reply.code(400).send({ error: 'invalid_attestation_id' });
    }

    await soroban.revoke(env.EAS_ATTESTER_SECRET, attestationId.toLowerCase());

    const revokerPub = Keypair.fromSecret(env.EAS_ATTESTER_SECRET).publicKey();
    await db.query(
      `UPDATE attestations
       SET revoked=TRUE, revoked_by=$2, revoked_timestamp=$3
       WHERE attestation_id=$1`,
      [attestationId.toLowerCase(), revokerPub, '0']
    );

    return { ok: true };
  });

  app.get('/verify/:attestationId', async (req, reply) => {
    if (!env.EAS_SCHEMA_CREATOR_SECRET) {
      return reply.code(500).send({ error: 'missing_EAS_SCHEMA_CREATOR_SECRET' });
    }
    const attestationId = (req.params as any).attestationId as string;
    if (!/^[0-9a-fA-F]{64}$/.test(attestationId)) {
      return reply.code(400).send({ error: 'invalid_attestation_id' });
    }
    const sourcePub = Keypair.fromSecret(env.EAS_SCHEMA_CREATOR_SECRET).publicKey();
    const v = await soroban.verify(sourcePub, attestationId.toLowerCase());
    return { result: jsonSafe(v) };
  });

  return app;
}
