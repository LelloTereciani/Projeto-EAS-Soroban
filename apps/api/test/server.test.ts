import { describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { buildServer } from '../src/server.js';

function hex64(ch: string) {
  return ch.repeat(64);
}

function mkEnv(overrides: Partial<any> = {}) {
  return {
    LOG_LEVEL: 'silent',
    EAS_SCHEMA_CREATOR_SECRET: undefined,
    EAS_ATTESTER_SECRET: undefined,
    ...overrides
  } as any;
}

describe('api server', () => {
  it('GET /healthz', async () => {
    const env = mkEnv();
    const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as any;
    const soroban = {} as any;

    const app = buildServer(env, db, soroban);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('POST /schemas -> 500 when missing creator secret', async () => {
    const env = mkEnv({ EAS_SCHEMA_CREATOR_SECRET: undefined });
    const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as any;
    const soroban = { createSchema: vi.fn() } as any;

    const app = buildServer(env, db, soroban);
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/schemas',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ schemaUri: 'ipfs://x', revocable: true, expiresAllowed: false, attesterMode: 0 })
    });
    await app.close();

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'missing_EAS_SCHEMA_CREATOR_SECRET' });
    expect(soroban.createSchema).not.toHaveBeenCalled();
  });

  it('POST /schemas -> calls soroban + inserts best-effort row', async () => {
    const creator = Keypair.random();
    const env = mkEnv({ EAS_SCHEMA_CREATOR_SECRET: creator.secret() });

    const schemaUri = 'ipfs://local/schema.json';
    const schemaId = crypto.createHash('sha256').update(schemaUri).digest('hex');

    const db = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 }))
    } as any;

    const soroban = {
      createSchema: vi.fn(async () => ({ schemaId, schemaUriHash: schemaId }))
    } as any;

    const app = buildServer(env, db, soroban);
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/schemas',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ schemaUri, revocable: true, expiresAllowed: false, attesterMode: 0 })
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ schemaId, schemaUriHash: schemaId });

    expect(soroban.createSchema).toHaveBeenCalledTimes(1);
    // SELECT existing + INSERT best-effort
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(String(db.query.mock.calls[0][0])).toMatch(/SELECT schema_id/i);
    expect(String(db.query.mock.calls[1][0])).toMatch(/INSERT INTO schemas/i);
    expect(db.query.mock.calls[1][1][0]).toBe(schemaId);
    expect(db.query.mock.calls[1][1][2]).toBe(schemaId);
  });

  it('POST /schemas -> idempotent when schema exists in DB', async () => {
    const creator = Keypair.random();
    const env = mkEnv({ EAS_SCHEMA_CREATOR_SECRET: creator.secret() });

    const schemaUri = 'https://portifolio.cloud/EAS/';
    const schemaId = crypto.createHash('sha256').update(schemaUri).digest('hex');

    const db = {
      query: vi.fn(async (sql: string) => {
        if (/SELECT schema_id/i.test(sql)) {
          return { rowCount: 1, rows: [{ schema_id: schemaId, schema_uri_hash: schemaId }] };
        }
        return { rowCount: 0, rows: [] };
      })
    } as any;

    const soroban = { createSchema: vi.fn() } as any;

    const app = buildServer(env, db, soroban);
    await app.ready();
    const res = await app.inject({
      method: 'POST',
      url: '/schemas',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ schemaUri, revocable: true, expiresAllowed: false, attesterMode: 0 })
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ schemaId, schemaUriHash: schemaId, existed: true });
    expect(soroban.createSchema).not.toHaveBeenCalled();
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('POST /attestations -> computes nonce=current+1 and returns dataHash', async () => {
    const creator = Keypair.random();
    const attester = Keypair.random();

    const env = mkEnv({
      EAS_SCHEMA_CREATOR_SECRET: creator.secret(),
      EAS_ATTESTER_SECRET: attester.secret()
    });

    const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as any;

    const soroban = {
      getNonce: vi.fn(async () => 0n),
      attest: vi.fn(async () => ({ attestationId: hex64('c') }))
    } as any;

    const app = buildServer(env, db, soroban);
    await app.ready();

    const schemaId = hex64('d');
    const payload1 = { b: 1, a: 2 };
    const payload2 = { a: 2, b: 1 };

    const res1 = await app.inject({
      method: 'POST',
      url: '/attestations',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ schemaId, subject: attester.publicKey(), payload: payload1, expirationLedger: null })
    });
    const res2 = await app.inject({
      method: 'POST',
      url: '/attestations',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ schemaId, subject: attester.publicKey(), payload: payload2, expirationLedger: null })
    });

    await app.close();

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const j1 = res1.json() as any;
    const j2 = res2.json() as any;
    expect(j1.attestationId).toBe(hex64('c'));
    expect(j1.nonce).toBe('1');
    expect(j1.dataHash).toMatch(/^[0-9a-f]{64}$/);
    // stable hashing: same payload with different key ordering
    expect(j2.dataHash).toBe(j1.dataHash);

    expect(soroban.getNonce).toHaveBeenCalled();
    expect(soroban.attest).toHaveBeenCalled();
    expect(db.query).toHaveBeenCalled();
  });

  it('GET /verify/:attestationId -> jsonSafe encodes bigint and bytes', async () => {
    const creator = Keypair.random();
    const env = mkEnv({ EAS_SCHEMA_CREATOR_SECRET: creator.secret() });
    const db = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } as any;

    const soroban = {
      verify: vi.fn(async () => ({ amount: 123n, raw: new Uint8Array([1, 2, 255]) }))
    } as any;

    const app = buildServer(env, db, soroban);
    await app.ready();
    const res = await app.inject({ method: 'GET', url: `/verify/${hex64('e')}` });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: { amount: '123', raw: '0102ff' } });
  });
});
