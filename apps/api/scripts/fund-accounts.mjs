import fs from 'node:fs';
import path from 'node:path';
import { Keypair } from '@stellar/stellar-sdk';
import { Server } from '@stellar/stellar-sdk/rpc';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..', '..', '..');
const envPath = path.join(root, '.env');

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim();
    out[k] = v.replace(/^"|"$/g, '');
  }
  return out;
}

if (!fs.existsSync(envPath)) {
  console.error('Missing .env. Run: pnpm accounts:gen');
  process.exit(1);
}

const env = parseEnv(fs.readFileSync(envPath, 'utf8'));
const rpcUrl = env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const rpc = new Server(rpcUrl);

const secrets = [env.EAS_ADMIN_SECRET, env.EAS_SCHEMA_CREATOR_SECRET, env.EAS_ATTESTER_SECRET].filter(Boolean);
if (secrets.length === 0) {
  console.error('No secrets found in .env');
  process.exit(1);
}

for (const sec of secrets) {
  const kp = Keypair.fromSecret(sec);
  const pk = kp.publicKey();
  process.stdout.write(`Funding ${pk} ... `);
  try {
    const tx = await rpc.fundAddress(pk);
    console.log(`ok (hash ${tx.txHash ?? tx.hash ?? 'n/a'})`);
  } catch (e) {
    console.log('failed');
    console.error(e?.message ?? e);
  }
}
