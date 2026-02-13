import { scValToNative } from '@stellar/stellar-sdk';
import type pg from 'pg';
import type { Env } from './env.js';
import { EasSoroban } from './soroban.js';

async function getState(db: pg.Pool, key: string) {
  const res = await db.query('SELECT value FROM indexer_state WHERE key=$1', [key]);
  return res.rows[0]?.value as string | undefined;
}

async function setState(db: pg.Pool, key: string, value: string) {
  await db.query(
    'INSERT INTO indexer_state(key, value) VALUES($1, $2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value',
    [key, value]
  );
}

function scToHex(v: any) {
  const n = scValToNative(v);
  if (Buffer.isBuffer(n)) return n.toString('hex');
  if (n instanceof Uint8Array) return Buffer.from(n).toString('hex');
  return String(n);
}

export function startIndexer(env: Env, db: pg.Pool, soroban: EasSoroban) {
  let stopped = false;

  const loop = async () => {
    if (stopped) return;

    try {
      const cursor = await getState(db, 'events_cursor');
      const startLedgerStr = await getState(db, 'start_ledger');

      let startLedger = startLedgerStr ? Number(startLedgerStr) : env.INDEXER_START_LEDGER;
      if (!cursor && startLedger === 0) {
        // Default: don't start from genesis, start close to "now".
        const latest = await soroban.rpc.getLatestLedger();
        startLedger = Math.max(0, Number(latest.sequence) - 500);
        await setState(db, 'start_ledger', String(startLedger));
      }

      const req: any = {
        limit: 100,
        filters: [
          {
            type: 'contract',
            contractIds: [soroban.contractId]
          }
        ]
      };
      if (cursor) {
        req.cursor = cursor;
      } else {
        req.startLedger = startLedger;
      }

      const resp = await soroban.rpc.getEvents(req);

      const events = resp.events ?? [];
      for (const evt of events) {
        const topic0 = evt.topic?.[0];
        if (!topic0) continue;

        const name = scValToNative(topic0);
        if (name === 'SchemaCreated') {
          const v = evt.value;
          const arr = scValToNative(v) as any[];
          // [schema_id, creator, schema_uri_hash, revocable, expires_allowed, attester_mode, created_ledger]
          const schemaId = Buffer.from(arr[0]).toString('hex');
          const creator = String(arr[1]);
          const schemaUriHash = Buffer.from(arr[2]).toString('hex');
          const revocable = Boolean(arr[3]);
          const expiresAllowed = Boolean(arr[4]);
          const attesterMode = Number(arr[5]);
          const createdLedger = BigInt(arr[6]);

          await db.query(
            `INSERT INTO schemas(schema_id, creator, schema_uri_hash, revocable, expires_allowed, attester_mode, created_ledger)
             VALUES($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT(schema_id) DO NOTHING`,
            [schemaId, creator, schemaUriHash, revocable, expiresAllowed, attesterMode, createdLedger.toString()]
          );
        } else if (name === 'Attested') {
          const arr = scValToNative(evt.value) as any[];
          // [attestation_id, schema_id, attester, subject, data_hash, timestamp, expiration]
          const attestationId = Buffer.from(arr[0]).toString('hex');
          const schemaId = Buffer.from(arr[1]).toString('hex');
          const attester = String(arr[2]);
          const subject = String(arr[3]);
          const dataHash = Buffer.from(arr[4]).toString('hex');
          const timestamp = BigInt(arr[5]);
          const expiration = arr[6] === null || arr[6] === undefined ? null : BigInt(arr[6]);

          await db.query(
            `INSERT INTO attestations(attestation_id, schema_id, attester, subject, data_hash, timestamp, expiration)
             VALUES($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT(attestation_id) DO NOTHING`,
            [
              attestationId,
              schemaId,
              attester,
              subject,
              dataHash,
              timestamp.toString(),
              expiration ? expiration.toString() : null
            ]
          );
        } else if (name === 'Revoked') {
          const arr = scValToNative(evt.value) as any[];
          // [attestation_id, revoker, timestamp]
          const attestationId = Buffer.from(arr[0]).toString('hex');
          const revoker = String(arr[1]);
          const timestamp = BigInt(arr[2]);

          await db.query(
            `UPDATE attestations
             SET revoked=TRUE, revoked_by=$2, revoked_timestamp=$3
             WHERE attestation_id=$1`,
            [attestationId, revoker, timestamp.toString()]
          );
        }

      }

      // Cursor for pagination.
      await setState(db, 'events_cursor', resp.cursor);
    } catch (e: any) {
      // Keep indexer best-effort; it should not kill the API.
      console.error('[indexer] error', e?.message ?? e);
    } finally {
      if (!stopped) setTimeout(loop, env.INDEXER_POLL_MS);
    }
  };

  setTimeout(loop, 250);

  return {
    stop() {
      stopped = true;
    }
  };
}
