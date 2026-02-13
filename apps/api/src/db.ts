import pg from 'pg';
import type { Env } from './env.js';

export function createPool(env: Env) {
  return new pg.Pool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASSWORD
  });
}
