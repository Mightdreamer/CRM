import { Hono } from 'hono';
import { count, eq } from 'drizzle-orm';
import { businesses, leads } from '@crm/db/schema';
import { isValidTaxId } from '@crm/core/dgii';
import {
  leadStatuses,
  leadStatusUpdateSchema,
} from '@crm/contracts/lead';
import { businessFiscalProvisioningSchema } from '@crm/contracts/fiscal';
import {
  getLead,
  listLeads,
  updateLeadStatus,
} from '../domain/leads';
import { getDb } from '../lib/db';
import { notFoundError, validationError } from '../lib/errors';
import { apiKeyHint, encryptApiKey } from '../lib/fiscal-platform/crypto';
import { noContent, ok } from '../lib/responses';
import { getStaff, staffMiddleware, type StaffEnv } from '../middleware/staff';

const route = new Hono<StaffEnv>();

route.use('*', staffMiddleware);

route.get('/me', (c) => {
  const staff = getStaff(c);
  return ok(c, {
    userId: staff.userId,
    email: staff.email,
    staffRole: staff.staffRole,
  });
});

/**
 * Counts for the admin dashboard. Cheap aggregates over small tables.
 */
route.get('/stats', async (c) => {
  const db = getDb();
  const [leadsPending, businessesTrial, businessesActive, businessesPastDue] =
    await Promise.all([
      db
        .select({ value: count() })
        .from(leads)
        .where(eq(leads.status, 'pending')),
      db
        .select({ value: count() })
        .from(businesses)
        .where(eq(businesses.subscriptionStatus, 'trial')),
      db
        .select({ value: count() })
        .from(businesses)
        .where(eq(businesses.subscriptionStatus, 'active')),
      db
        .select({ value: count() })
        .from(businesses)
        .where(eq(businesses.subscriptionStatus, 'past_due')),
    ]);
  return ok(c, {
    leadsPending: leadsPending[0]?.value ?? 0,
    businessesTrial: businessesTrial[0]?.value ?? 0,
    businessesActive: businessesActive[0]?.value ?? 0,
    businessesPastDue: businessesPastDue[0]?.value ?? 0,
  });
});

// ---- Leads ------------------------------------------------------------

route.get('/leads', async (c) => {
  const url = new URL(c.req.url);
  const statusParam = url.searchParams.get('status');
  const status = leadStatuses.includes(statusParam as never)
    ? (statusParam as (typeof leadStatuses)[number])
    : undefined;
  const q = url.searchParams.get('q') ?? undefined;
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get('size') ?? '25')));

  const result = await listLeads({ status, q, page, size });
  return ok(c, { ...result, page, size });
});

route.get('/leads/:id', async (c) => {
  const id = c.req.param('id');
  const row = await getLead(id);
  return ok(c, row);
});

route.patch('/leads/:id', async (c) => {
  const staff = getStaff(c);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = leadStatusUpdateSchema.safeParse(body);
  if (!parsed.success) {
    throw validationError(
      'Validation failed',
      parsed.error.flatten().fieldErrors as Record<string, string[]>,
    );
  }
  await updateLeadStatus(id, parsed.data, staff.userId);
  return noContent(c);
});

// ---- Business fiscal provisioning ------------------------------------
//
// Staff-only. Manages the columns in `businesses` that live behind
// docs/FISCAL_INTEGRATION_PLAN.md D8 (activation of the fiscal-platform
// integration is not self-serve — staff pastes tenant_id + API key
// obtained from fiscal-platform's admin-portal).
//
// The plaintext API key is never returned to the client — only the hint
// (fiscal_platform_api_key_hint, e.g. "fpk_…ab12").

function fiscalProvisioningView(row: {
  id: string;
  fiscalEnabled: boolean;
  fiscalPlatformTenantId: string | null;
  fiscalPlatformApiKeyHint: string | null;
  fiscalProvisionedAt: Date | null;
  fiscalIntegrationMode: string;
}) {
  return {
    id: row.id,
    fiscal_enabled: row.fiscalEnabled,
    fiscal_platform_tenant_id: row.fiscalPlatformTenantId,
    fiscal_platform_api_key_hint: row.fiscalPlatformApiKeyHint,
    fiscal_provisioned_at: row.fiscalProvisionedAt?.toISOString() ?? null,
    fiscal_integration_mode: row.fiscalIntegrationMode,
  };
}

route.get('/businesses/:id/fiscal-provisioning', async (c) => {
  const id = c.req.param('id');
  const db = getDb();
  const rows = await db
    .select({
      id: businesses.id,
      fiscalEnabled: businesses.fiscalEnabled,
      fiscalPlatformTenantId: businesses.fiscalPlatformTenantId,
      fiscalPlatformApiKeyHint: businesses.fiscalPlatformApiKeyHint,
      fiscalProvisionedAt: businesses.fiscalProvisionedAt,
      fiscalIntegrationMode: businesses.fiscalIntegrationMode,
    })
    .from(businesses)
    .where(eq(businesses.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) throw notFoundError('Business not found');
  return ok(c, fiscalProvisioningView(row));
});

route.patch('/businesses/:id/fiscal-provisioning', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = businessFiscalProvisioningSchema.safeParse(body);
  if (!parsed.success) {
    throw validationError(
      'Validation failed',
      parsed.error.flatten().fieldErrors as Record<string, string[]>,
    );
  }

  const db = getDb();
  const currentRows = await db
    .select({
      id: businesses.id,
      taxId: businesses.taxId,
      fiscalEnabled: businesses.fiscalEnabled,
      fiscalPlatformTenantId: businesses.fiscalPlatformTenantId,
      fiscalPlatformApiKeyEncrypted: businesses.fiscalPlatformApiKeyEncrypted,
      fiscalProvisionedAt: businesses.fiscalProvisionedAt,
    })
    .from(businesses)
    .where(eq(businesses.id, id))
    .limit(1);
  const current = currentRows[0];
  if (!current) throw notFoundError('Business not found');

  const updates: Partial<typeof businesses.$inferInsert> = {};

  if (parsed.data.tenant_id !== undefined) {
    updates.fiscalPlatformTenantId = parsed.data.tenant_id;
  }
  if (parsed.data.api_key !== undefined) {
    updates.fiscalPlatformApiKeyEncrypted = encryptApiKey(parsed.data.api_key);
    updates.fiscalPlatformApiKeyHint = apiKeyHint(parsed.data.api_key);
  }
  if (parsed.data.fiscal_integration_mode !== undefined) {
    updates.fiscalIntegrationMode = parsed.data.fiscal_integration_mode;
  }

  if (parsed.data.fiscal_enabled !== undefined) {
    updates.fiscalEnabled = parsed.data.fiscal_enabled;

    // Only validate coherence when *activating*. Deactivation is always
    // permitted (staff may want to pause billing/emission).
    if (parsed.data.fiscal_enabled) {
      const nextTenantId =
        updates.fiscalPlatformTenantId ?? current.fiscalPlatformTenantId;
      const nextApiKey =
        updates.fiscalPlatformApiKeyEncrypted ??
        current.fiscalPlatformApiKeyEncrypted;

      const fieldErrors: Record<string, string[]> = {};
      if (!current.taxId) {
        fieldErrors.tax_id = [
          'Business tax_id is empty — set it in profile settings first.',
        ];
      } else if (!isValidTaxId(current.taxId)) {
        fieldErrors.tax_id = [
          'Business tax_id is not a valid Dominican RNC or Cédula (check digit fails).',
        ];
      }
      if (!nextTenantId) {
        fieldErrors.tenant_id = ['Required to enable fiscal.'];
      }
      if (!nextApiKey) {
        fieldErrors.api_key = ['Required to enable fiscal.'];
      }
      if (Object.keys(fieldErrors).length > 0) {
        throw validationError(
          'Cannot enable fiscal until provisioning is complete',
          fieldErrors,
        );
      }

      // First-ever activation stamps the provisioning date. Toggling
      // off/on later preserves the original timestamp (grandfathering
      // relies on this — see D10 in FISCAL_INTEGRATION_PLAN.md).
      if (!current.fiscalProvisionedAt) {
        updates.fiscalProvisionedAt = new Date();
      }
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.update(businesses).set(updates).where(eq(businesses.id, id));
  }

  const finalRows = await db
    .select({
      id: businesses.id,
      fiscalEnabled: businesses.fiscalEnabled,
      fiscalPlatformTenantId: businesses.fiscalPlatformTenantId,
      fiscalPlatformApiKeyHint: businesses.fiscalPlatformApiKeyHint,
      fiscalProvisionedAt: businesses.fiscalProvisionedAt,
      fiscalIntegrationMode: businesses.fiscalIntegrationMode,
    })
    .from(businesses)
    .where(eq(businesses.id, id))
    .limit(1);
  return ok(c, fiscalProvisioningView(finalRows[0]!));
});

export { route as adminRoute };
