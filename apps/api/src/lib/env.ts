function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

function requiredUrl(name: string): string {
  const value = required(name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must use http or https`);
  }
  return value.replace(/\/+$/, '');
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function encryptionKey(): string {
  const raw = required('FISCAL_ENCRYPTION_KEY');
  const decoded = Buffer.from(raw, 'base64');
  if (decoded.length !== 32) {
    throw new Error('FISCAL_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return raw;
}

export const env = {
  NEXT_PUBLIC_SUPABASE_URL: required('NEXT_PUBLIC_SUPABASE_URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  SUPABASE_SERVICE_ROLE_KEY: required('SUPABASE_SERVICE_ROLE_KEY'),
  SUPABASE_DB_POOLER_URL: required('SUPABASE_DB_POOLER_URL'),
  OPENAI_API_KEY: optional('OPENAI_API_KEY'),
  OPENAI_EXPENSE_MODEL: optional('OPENAI_EXPENSE_MODEL', 'gpt-4o'),
  OPENAI_ASSISTANT_MODEL: optional('OPENAI_ASSISTANT_MODEL', 'gpt-4o'),
  // Anti-bot for /v1/public/leads. When unset, verification passes (dev mode).
  TURNSTILE_SECRET: optional('TURNSTILE_SECRET'),
  // Email transactional. When unset, sendEmail is a no-op (Step 3 hooks
  // these up; until then admin checks the /admin/leads queue manually).
  RESEND_API_KEY: optional('RESEND_API_KEY'),
  EMAIL_FROM: optional('EMAIL_FROM'),
  EMAIL_ADMIN_ALERTS: optional('EMAIL_ADMIN_ALERTS'),
  FISCAL_PLATFORM_BASE_URL: requiredUrl('FISCAL_PLATFORM_BASE_URL'),
  FISCAL_ENCRYPTION_KEY: encryptionKey(),
  FISCAL_PLATFORM_TIMEOUT_MS: positiveInteger(
    'FISCAL_PLATFORM_TIMEOUT_MS',
    30_000,
  ),
  PORT: Number(process.env.PORT ?? 8080),
};
