import { z } from 'zod';

const boolFromString = (v: string) => ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

const EnvSchema = z.object({
  // Soroban
  SOROBAN_RPC_URL: z.string().url(),
  SOROBAN_NETWORK_PASSPHRASE: z.string().min(1),
  SOROBAN_CONTRACT_ID: z.string().min(1),

  EAS_ADMIN_SECRET: z.string().optional(),
  EAS_SCHEMA_CREATOR_SECRET: z.string().optional(),
  EAS_ATTESTER_SECRET: z.string().optional(),
  EAS_DEFAULT_SUBJECT: z.string().optional(),

  // DB
  DB_HOST: z.string().min(1).default('db'),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1).default('eas'),
  DB_USER: z.string().min(1).default('eas'),
  DB_PASSWORD: z.string().min(1).default('eas'),

  // API
  API_HOST: z.string().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.string().min(1).default('info'),

  // Indexer
  INDEXER_ENABLED: z.string().default('1').transform(boolFromString),
  INDEXER_POLL_MS: z.coerce.number().int().positive().default(2000),
  INDEXER_START_LEDGER: z.coerce.number().int().nonnegative().default(0)
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Keep it readable in logs.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  return parsed.data;
}
