process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.SUPABASE_DB_POOLER_URL ??= 'postgresql://test:test@localhost/test';
process.env.FISCAL_PLATFORM_BASE_URL ??= 'https://fiscal.example.test';
process.env.FISCAL_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
