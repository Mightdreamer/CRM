// One-off SQL migration runner using node-pg against SUPABASE_DB_POOLER_URL.
//
// Usage:
//   pnpm --filter @crm/db exec tsx scripts/apply-migration.ts supabase/migrations/20260810000001_fiscal_integration_phase_a.sql
//
// Wraps the SQL in a transaction, so a syntax error or constraint
// violation rolls back the whole file. Intended for local/dev application
// of migrations when neither Supabase CLI nor psql is installed.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';

async function main() {
  const [, , relativePath] = process.argv;
  if (!relativePath) {
    console.error('Usage: apply-migration.ts <path-to-sql-file>');
    process.exit(1);
  }

  const url =
    process.env.SUPABASE_DB_POOLER_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('Missing SUPABASE_DB_POOLER_URL (or DATABASE_URL) in env.');
    process.exit(1);
  }

  const absolute = resolve(process.cwd(), relativePath);
  const sql = readFileSync(absolute, 'utf8');
  console.log(`Applying migration: ${absolute}`);

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('✓ Migration applied and committed.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('✗ Migration failed — rolled back.');
    console.error(err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
