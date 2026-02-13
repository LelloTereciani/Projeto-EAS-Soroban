import type pg from 'pg';

const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS indexer_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schemas (
  schema_id TEXT PRIMARY KEY,
  creator TEXT NOT NULL,
  schema_uri_hash TEXT NOT NULL,
  revocable BOOLEAN NOT NULL,
  expires_allowed BOOLEAN NOT NULL,
  attester_mode INTEGER NOT NULL,
  created_ledger BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS attestations (
  attestation_id TEXT PRIMARY KEY,
  schema_id TEXT NOT NULL,
  attester TEXT NOT NULL,
  subject TEXT NOT NULL,
  data_hash TEXT NOT NULL,
  payload_json JSONB,
  timestamp BIGINT NOT NULL,
  expiration BIGINT,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  revoked_by TEXT,
  revoked_timestamp BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attestations_subject_idx ON attestations(subject);
CREATE INDEX IF NOT EXISTS attestations_schema_idx ON attestations(schema_id);
`;

export async function migrate(db: pg.Pool) {
  await db.query(MIGRATION_SQL);
}
