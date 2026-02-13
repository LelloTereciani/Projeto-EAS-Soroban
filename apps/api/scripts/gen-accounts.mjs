import fs from 'node:fs';
import path from 'node:path';
import { Keypair } from '@stellar/stellar-sdk';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..', '..', '..');
const envPath = path.join(root, '.env');

function writeEnv(kv) {
  const lines = [];
  for (const [k, v] of Object.entries(kv)) {
    lines.push(`${k}=${v}`);
  }
  lines.push('');
  fs.writeFileSync(envPath, lines.join('\n'), { encoding: 'utf8', flag: 'w' });
}

const admin = Keypair.random();
const creator = Keypair.random();
const attester = Keypair.random();
const subject = Keypair.random();

const out = {
  // Soroban
  SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
  SOROBAN_NETWORK_PASSPHRASE: '"Test SDF Network ; September 2015"',
  SOROBAN_CONTRACT_ID: '',

  // Keys (TESTNET ONLY)
  EAS_ADMIN_SECRET: admin.secret(),
  EAS_SCHEMA_CREATOR_SECRET: creator.secret(),
  EAS_ATTESTER_SECRET: attester.secret(),
  EAS_DEFAULT_SUBJECT: subject.publicKey(),

  // DB
  DB_HOST: 'db',
  DB_PORT: '5432',
  DB_NAME: 'eas',
  DB_USER: 'eas',
  DB_PASSWORD: 'eas',

  // API
  API_HOST: '0.0.0.0',
  API_PORT: '4000',
  LOG_LEVEL: 'info',

  // Indexer
  INDEXER_ENABLED: '1',
  INDEXER_POLL_MS: '2000',
  INDEXER_START_LEDGER: '0'
};

writeEnv(out);

console.log('Wrote .env');
console.log('\nPublic keys:');
console.log('ADMIN', admin.publicKey());
console.log('CREATOR', creator.publicKey());
console.log('ATTESTER', attester.publicKey());
console.log('SUBJECT', subject.publicKey());
