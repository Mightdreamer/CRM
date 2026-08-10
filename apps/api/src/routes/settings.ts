import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { businesses } from '@crm/db/schema';
import {
  numberingSchema,
  pdfSettingsSchema,
  profileSchema,
  taxSettingsSchema,
} from '@crm/contracts/settings';
import { businessFiscalSettingsSchema } from '@crm/contracts/fiscal';
import { getDb } from '../lib/db';
import {
  conflictError,
  forbiddenError,
  notFoundError,
  validationError,
} from '../lib/errors';
import { noContent, ok } from '../lib/responses';
import {
  extractStoragePath,
  getSupabaseStorage,
} from '../lib/supabase-storage';
import { type AuthEnv, getCtx } from '../middleware/auth';

const LOGO_BUCKET = 'logos';
const ALLOWED_LOGO_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
]);
const MAX_LOGO_BYTES = 1_048_576; // 1 MB

const settings = new Hono<AuthEnv>();

settings.get('/', async (c) => {
  const ctx = getCtx(c);
  const db = getDb();
  const rows = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, ctx.businessId))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFoundError('Business not found');
  return ok(c, row);
});

settings.patch('/profile', async (c) => {
  const ctx = getCtx(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    throw validationError('Validation failed', parsed.error.flatten().fieldErrors);
  }
  const db = getDb();
  const updates = {
    name: parsed.data.name,
    legalName: parsed.data.legal_name ?? null,
    taxId: parsed.data.tax_id ?? null,
    email: parsed.data.email ?? null,
    phone: parsed.data.phone ?? null,
    address: parsed.data.address ?? null,
    city: parsed.data.city ?? null,
    country: parsed.data.country ?? 'DO',
  };
  await db.update(businesses).set(updates).where(eq(businesses.id, ctx.businessId));
  return ok(c, { updated: true });
});

settings.patch('/tax', async (c) => {
  const ctx = getCtx(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = taxSettingsSchema.safeParse(body);
  if (!parsed.success) {
    throw validationError('Validation failed', parsed.error.flatten().fieldErrors);
  }
  const db = getDb();
  await db
    .update(businesses)
    .set({
      defaultCurrency: parsed.data.default_currency,
      defaultTaxRate: String(parsed.data.default_tax_rate),
      defaultPaymentTermsDays: parsed.data.default_payment_terms_days,
    })
    .where(eq(businesses.id, ctx.businessId));
  return ok(c, { updated: true });
});

settings.patch('/numbering', async (c) => {
  const ctx = getCtx(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = numberingSchema.safeParse(body);
  if (!parsed.success) {
    throw validationError('Validation failed', parsed.error.flatten().fieldErrors);
  }
  const db = getDb();
  const currentRows = await db
    .select({
      invoiceNextNumber: businesses.invoiceNextNumber,
      quotationNextNumber: businesses.quotationNextNumber,
    })
    .from(businesses)
    .where(eq(businesses.id, ctx.businessId))
    .limit(1);
  const current = currentRows[0];
  if (!current) throw notFoundError('Business not found');

  if (parsed.data.invoice_next_number < current.invoiceNextNumber) {
    throw conflictError('Invoice counter cannot move backwards');
  }
  if (parsed.data.quotation_next_number < current.quotationNextNumber) {
    throw conflictError('Quotation counter cannot move backwards');
  }

  await db
    .update(businesses)
    .set({
      invoicePrefix: parsed.data.invoice_prefix,
      invoiceNextNumber: parsed.data.invoice_next_number,
      quotationPrefix: parsed.data.quotation_prefix,
      quotationNextNumber: parsed.data.quotation_next_number,
    })
    .where(eq(businesses.id, ctx.businessId));
  return ok(c, { updated: true });
});

// Owner-editable fiscal metadata. Only writable when staff has activated
// the fiscal integration for this business — see FISCAL_INTEGRATION_PLAN.md
// (D8 + Fase A). Provisioning fields (tenant_id, api_key, fiscal_enabled)
// live under /v1/admin and are unreachable from here.
settings.patch('/fiscal', async (c) => {
  const ctx = getCtx(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = businessFiscalSettingsSchema.safeParse(body);
  if (!parsed.success) {
    throw validationError(
      'Validation failed',
      parsed.error.flatten().fieldErrors as Record<string, string[]>,
    );
  }

  const db = getDb();
  const rows = await db
    .select({ fiscalEnabled: businesses.fiscalEnabled })
    .from(businesses)
    .where(eq(businesses.id, ctx.businessId))
    .limit(1);
  const current = rows[0];
  if (!current) throw notFoundError('Business not found');
  if (!current.fiscalEnabled) {
    throw forbiddenError(
      'Fiscal integration is not enabled for this business. Contact support to activate.',
    );
  }

  await db
    .update(businesses)
    .set({
      fiscalDefaultDocumentType: parsed.data.default_document_type,
      fiscalDefaultTipoIngresos: parsed.data.default_tipo_ingresos,
      fiscalTradeName: parsed.data.trade_name ?? null,
      fiscalBranch: parsed.data.branch ?? null,
      fiscalEconomicActivity: parsed.data.economic_activity ?? null,
      fiscalMunicipality: parsed.data.municipality ?? null,
      fiscalProvince: parsed.data.province ?? null,
    })
    .where(eq(businesses.id, ctx.businessId));
  return ok(c, { updated: true });
});

settings.patch('/pdf', async (c) => {
  const ctx = getCtx(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = pdfSettingsSchema.safeParse(body);
  if (!parsed.success) {
    throw validationError('Validation failed', parsed.error.flatten().fieldErrors);
  }
  const db = getDb();
  await db
    .update(businesses)
    .set({ pdfSettings: parsed.data })
    .where(eq(businesses.id, ctx.businessId));
  return ok(c, { updated: true });
});

settings.post('/logo', async (c) => {
  const ctx = getCtx(c);
  const form = await c.req.formData();
  const file = form.get('logo');
  if (!(file instanceof File) || file.size === 0) {
    throw validationError('No file uploaded');
  }
  if (!ALLOWED_LOGO_MIMES.has(file.type)) {
    throw validationError(`Unsupported file type: ${file.type}`);
  }
  if (file.size > MAX_LOGO_BYTES) {
    throw validationError('File exceeds 1 MB');
  }

  const ext = file.name.includes('.')
    ? (file.name.split('.').pop() ?? 'bin').toLowerCase()
    : 'bin';
  const path = `${ctx.businessId}/${randomUUID()}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const storage = getSupabaseStorage();
  const { error: upErr } = await storage.storage
    .from(LOGO_BUCKET)
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (upErr) {
    throw validationError(`Upload failed: ${upErr.message}`);
  }
  const { data: pub } = storage.storage.from(LOGO_BUCKET).getPublicUrl(path);
  const logoUrl = pub.publicUrl;

  // Replace previous logo if any.
  const db = getDb();
  const existingRows = await db
    .select({ logoUrl: businesses.logoUrl })
    .from(businesses)
    .where(eq(businesses.id, ctx.businessId))
    .limit(1);
  const prev = existingRows[0]?.logoUrl;
  if (prev) {
    const prevPath = extractStoragePath(prev, LOGO_BUCKET);
    if (prevPath) {
      await storage.storage.from(LOGO_BUCKET).remove([prevPath]);
    }
  }

  await db
    .update(businesses)
    .set({ logoUrl })
    .where(eq(businesses.id, ctx.businessId));

  return ok(c, { logo_url: logoUrl });
});

settings.delete('/logo', async (c) => {
  const ctx = getCtx(c);
  const db = getDb();
  const rows = await db
    .select({ logoUrl: businesses.logoUrl })
    .from(businesses)
    .where(eq(businesses.id, ctx.businessId))
    .limit(1);
  const current = rows[0]?.logoUrl;
  if (current) {
    const path = extractStoragePath(current, LOGO_BUCKET);
    if (path) {
      const storage = getSupabaseStorage();
      await storage.storage.from(LOGO_BUCKET).remove([path]);
    }
  }
  await db
    .update(businesses)
    .set({ logoUrl: null })
    .where(eq(businesses.id, ctx.businessId));
  return noContent(c);
});

export { settings };
