import { and, eq, isNull } from 'drizzle-orm';
import { businesses, customers, invoiceItems, invoices } from '@crm/db/schema';
import {
  DocumentStatus,
  type FiscalDocument,
  type FiscalEmissionResult,
  type FiscalMetadataSnapshot,
} from '@crm/contracts/fiscal';
import { getDb } from '../db';
import {
  badGatewayError,
  conflictError,
  notFoundError,
  validationError,
} from '../errors';
import type { Ctx } from '../../middleware/auth';
import { createFiscalClient } from './client';
import { FiscalPlatformError } from './errors';
import {
  buildInvoiceRequest,
  FiscalMapperError,
  type FiscalInvoiceInputs,
} from './mapper';

const LOCALLY_ISSUED_STATUSES = new Set([
  'issued',
  'partially_paid',
  'paid',
  'overdue',
]);

interface EmissionRecord {
  inputs: FiscalInvoiceInputs;
  credentials: Parameters<typeof createFiscalClient>[0];
  status: string;
  fiscalOptOut: boolean;
  fiscalProvisionedAt: Date | null;
  createdAt: Date;
  fiscalMetadata: FiscalMetadataSnapshot;
}

function asMetadata(value: unknown): FiscalMetadataSnapshot {
  return value && typeof value === 'object'
    ? (value as FiscalMetadataSnapshot)
    : {};
}

async function loadEmissionRecord(
  ctx: Ctx,
  id: string,
): Promise<EmissionRecord | null> {
  const db = getDb();
  const [headerRows, items] = await Promise.all([
    db
      .select({
        business: {
          fiscalEnabled: businesses.fiscalEnabled,
          fiscalDefaultDocumentType: businesses.fiscalDefaultDocumentType,
          fiscalDefaultTipoIngresos: businesses.fiscalDefaultTipoIngresos,
          taxId: businesses.taxId,
          name: businesses.name,
          legalName: businesses.legalName,
          email: businesses.email,
          phone: businesses.phone,
          address: businesses.address,
          fiscalTradeName: businesses.fiscalTradeName,
          fiscalBranch: businesses.fiscalBranch,
          fiscalEconomicActivity: businesses.fiscalEconomicActivity,
          fiscalMunicipality: businesses.fiscalMunicipality,
          fiscalProvince: businesses.fiscalProvince,
        },
        credentials: {
          fiscalEnabled: businesses.fiscalEnabled,
          fiscalPlatformTenantId: businesses.fiscalPlatformTenantId,
          fiscalPlatformApiKeyEncrypted:
            businesses.fiscalPlatformApiKeyEncrypted,
          fiscalIntegrationMode: businesses.fiscalIntegrationMode,
        },
        invoice: {
          id: invoices.id,
          issueDate: invoices.issueDate,
          dueDate: invoices.dueDate,
          currency: invoices.currency,
          subtotal: invoices.subtotal,
          discountTotal: invoices.discountTotal,
          taxTotal: invoices.taxTotal,
          total: invoices.total,
          amountPaid: invoices.amountPaid,
          balanceDue: invoices.balanceDue,
        },
        customer: {
          name: customers.name,
          companyName: customers.companyName,
          taxId: customers.taxId,
          email: customers.email,
          address: customers.address,
          city: customers.city,
        },
        status: invoices.status,
        fiscalOptOut: invoices.fiscalOptOut,
        fiscalMetadata: invoices.fiscalMetadata,
        createdAt: invoices.createdAt,
        fiscalProvisionedAt: businesses.fiscalProvisionedAt,
      })
      .from(invoices)
      .innerJoin(businesses, eq(businesses.id, invoices.businessId))
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(
        and(
          eq(invoices.id, id),
          eq(invoices.businessId, ctx.businessId),
          isNull(invoices.deletedAt),
        ),
      )
      .limit(1),
    db
      .select({
        productName: invoiceItems.productName,
        description: invoiceItems.description,
        quantity: invoiceItems.quantity,
        unitPrice: invoiceItems.unitPrice,
        discountPct: invoiceItems.discountPct,
        taxRate: invoiceItems.taxRate,
        lineSubtotal: invoiceItems.lineSubtotal,
        lineTax: invoiceItems.lineTax,
        lineTotal: invoiceItems.lineTotal,
        sortOrder: invoiceItems.sortOrder,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(
        and(
          eq(invoiceItems.invoiceId, id),
          eq(invoices.businessId, ctx.businessId),
          isNull(invoices.deletedAt),
        ),
      )
      .orderBy(invoiceItems.sortOrder),
  ]);
  const row = headerRows[0];
  if (!row) return null;
  return {
    inputs: {
      business: row.business,
      customer: row.customer,
      invoice: row.invoice,
      items,
    },
    credentials: row.credentials,
    status: row.status,
    fiscalOptOut: row.fiscalOptOut,
    fiscalProvisionedAt: row.fiscalProvisionedAt,
    createdAt: row.createdAt,
    fiscalMetadata: asMetadata(row.fiscalMetadata),
  };
}

async function mergeMetadata(
  ctx: Ctx,
  invoiceId: string,
  current: FiscalMetadataSnapshot,
  patch: Partial<FiscalMetadataSnapshot>,
): Promise<FiscalMetadataSnapshot> {
  const metadata = { ...current, ...patch };
  await getDb()
    .update(invoices)
    .set({ fiscalMetadata: metadata })
    .where(
      and(eq(invoices.id, invoiceId), eq(invoices.businessId, ctx.businessId)),
    );
  return metadata;
}

function normalizedError(error: unknown): { code: string; message: string } {
  if (error instanceof FiscalMapperError) {
    return {
      code: error.issues[0]?.code ?? 'FISCAL_VALIDATION_FAILED',
      message: error.message,
    };
  }
  if (error instanceof FiscalPlatformError) {
    return { code: error.code, message: error.userMessage };
  }
  return {
    code: 'FISCAL_EMISSION_FAILED',
    message: error instanceof Error ? error.message : 'Fiscal emission failed',
  };
}

function documentPatch(
  document: FiscalDocument,
  current: FiscalMetadataSnapshot,
  now: string,
): Partial<FiscalMetadataSnapshot> {
  return {
    documentId: document.id,
    eNcf: document.eNCF,
    status: document.status,
    trackId: document.trackId,
    submittedAt: current.submittedAt ?? now,
    lastCheckedAt: now,
    lastError:
      document.errorCode || document.errorMessage
        ? {
            code: document.errorCode ?? 'FISCAL_DOCUMENT_FAILED',
            message: document.errorMessage ?? 'Fiscal document failed',
          }
        : null,
  };
}

function assertEmissionAllowed(record: EmissionRecord): void {
  if (!record.inputs.business.fiscalEnabled) {
    throw conflictError('Fiscal integration is not enabled for this business');
  }
  if (!LOCALLY_ISSUED_STATUSES.has(record.status)) {
    throw conflictError('Only issued invoices can emit an e-CF');
  }
  if (record.fiscalOptOut) {
    throw conflictError('This invoice is opted out of fiscal emission');
  }
  if (
    !record.fiscalProvisionedAt ||
    record.createdAt < record.fiscalProvisionedAt
  ) {
    throw conflictError(
      'This invoice predates fiscal provisioning and cannot be emitted automatically',
    );
  }
}

async function submitLoaded(
  ctx: Ctx,
  invoiceId: string,
  record: EmissionRecord,
): Promise<FiscalEmissionResult> {
  if (record.fiscalMetadata.documentId) {
    return {
      attempted: false,
      outcome: 'already_submitted',
      metadata: record.fiscalMetadata,
    };
  }

  try {
    const payload = buildInvoiceRequest(record.inputs);
    const document = await createFiscalClient(record.credentials).submitInvoice(
      payload,
    );
    const now = new Date().toISOString();
    const metadata = await mergeMetadata(
      ctx,
      invoiceId,
      record.fiscalMetadata,
      documentPatch(document, record.fiscalMetadata, now),
    );
    console.info('[fiscal emission]', {
      businessId: ctx.businessId,
      invoiceId,
      documentId: document.id,
      status: document.status,
    });
    return {
      attempted: true,
      outcome:
        document.status === DocumentStatus.FAILED ? 'failed' : 'submitted',
      metadata,
    };
  } catch (error) {
    const lastError = normalizedError(error);
    const metadata = await mergeMetadata(ctx, invoiceId, record.fiscalMetadata, {
      lastCheckedAt: new Date().toISOString(),
      lastError,
    });
    console.error('[fiscal emission failed]', {
      businessId: ctx.businessId,
      invoiceId,
      code: lastError.code,
    });
    if (error instanceof FiscalMapperError) {
      throw validationError(
        'Fiscal invoice validation failed',
        Object.fromEntries(
          error.issues.map((entry) => [entry.field, [entry.message]]),
        ),
      );
    }
    if (error instanceof FiscalPlatformError) {
      throw badGatewayError(error.userMessage);
    }
    throw error;
  }
}

export async function emitInvoiceToFiscal(
  ctx: Ctx,
  invoiceId: string,
): Promise<FiscalEmissionResult> {
  const record = await loadEmissionRecord(ctx, invoiceId);
  if (!record) throw notFoundError('Invoice not found');
  assertEmissionAllowed(record);
  return submitLoaded(ctx, invoiceId, record);
}

export async function emitInvoiceAutomatically(
  ctx: Ctx,
  invoiceId: string,
): Promise<FiscalEmissionResult> {
  const record = await loadEmissionRecord(ctx, invoiceId);
  if (!record) throw notFoundError('Invoice not found');
  if (
    !record.inputs.business.fiscalEnabled ||
    record.fiscalOptOut ||
    !record.fiscalProvisionedAt ||
    record.createdAt < record.fiscalProvisionedAt
  ) {
    return {
      attempted: false,
      outcome: 'not_applicable',
      metadata: record.fiscalMetadata,
    };
  }
  if (record.fiscalMetadata.documentId) {
    return {
      attempted: false,
      outcome: 'already_submitted',
      metadata: record.fiscalMetadata,
    };
  }
  try {
    return await submitLoaded(ctx, invoiceId, record);
  } catch {
    const refreshed = await loadEmissionRecord(ctx, invoiceId);
    return {
      attempted: true,
      outcome: 'failed',
      metadata: refreshed?.fiscalMetadata ?? record.fiscalMetadata,
    };
  }
}

export async function retryInvoiceFiscalEmission(
  ctx: Ctx,
  invoiceId: string,
): Promise<FiscalEmissionResult> {
  const record = await loadEmissionRecord(ctx, invoiceId);
  if (!record) throw notFoundError('Invoice not found');
  assertEmissionAllowed(record);
  const documentId = record.fiscalMetadata.documentId;
  if (!documentId) throw conflictError('Invoice has no fiscal document to retry');
  if (record.fiscalMetadata.status !== DocumentStatus.FAILED) {
    throw conflictError('Only failed fiscal documents can be retried');
  }

  try {
    const document = await createFiscalClient(record.credentials).retryDocument(
      documentId,
    );
    const now = new Date().toISOString();
    const metadata = await mergeMetadata(
      ctx,
      invoiceId,
      record.fiscalMetadata,
      documentPatch(document, record.fiscalMetadata, now),
    );
    return {
      attempted: true,
      outcome:
        document.status === DocumentStatus.FAILED ? 'failed' : 'submitted',
      metadata,
    };
  } catch (error) {
    const lastError = normalizedError(error);
    await mergeMetadata(ctx, invoiceId, record.fiscalMetadata, {
      lastCheckedAt: new Date().toISOString(),
      lastError,
    });
    if (error instanceof FiscalPlatformError) {
      throw badGatewayError(error.userMessage);
    }
    throw error;
  }
}
