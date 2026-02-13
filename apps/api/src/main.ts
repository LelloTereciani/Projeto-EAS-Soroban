import 'dotenv/config';
import { loadEnv } from './env.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { EasSoroban } from './soroban.js';
import { buildServer } from './server.js';
import { startIndexer } from './indexer.js';

async function main() {
  const env = loadEnv();
  const db = createPool(env);
  await migrate(db);

  const soroban = new EasSoroban(env);

  if (env.INDEXER_ENABLED) {
    startIndexer(env, db, soroban);
  }

  const app = buildServer(env, db, soroban);
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
