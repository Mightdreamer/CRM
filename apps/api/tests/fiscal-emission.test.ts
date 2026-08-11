import { DocumentStatus, type FiscalDocument } from '@crm/contracts/fiscal';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  headerRows: [] as unknown[][],
  itemRows: [] as unknown[][],
  metadataWrites: [] as unknown[],
  selectCount: 0,
  submitInvoice: vi.fn(),
  retryDocument: vi.fn(),
  buildInvoiceRequest: vi.fn(() => ({ externalReference: 'invoice-1' })),
}));

vi.mock('../src/lib/db', () => ({
  getDb: () => ({
    select: () => {
      const isHeader = mocks.selectCount++ % 2 === 0;
      const terminal = () =>
        isHeader ? (mocks.headerRows.shift() ?? []) : (mocks.itemRows.shift() ?? []);
      const builder: Record<string, unknown> = {};
      builder.from = () => builder;
      builder.innerJoin = () => builder;
      builder.where = () => builder;
      builder.limit = terminal;
      builder.orderBy = terminal;
      return builder;
    },
    update: () => ({
      set: (value: { fiscalMetadata: unknown }) => {
        mocks.metadataWrites.push(value.fiscalMetadata);
        return { where: vi.fn().mockResolvedValue(undefined) };
      },
    }),
  }),
}));

vi.mock('../src/lib/fiscal-platform/client', () => ({
  createFiscalClient: () => ({
    submitInvoice: mocks.submitInvoice,
    retryDocument: mocks.retryDocument,
  }),
}));

vi.mock('../src/lib/fiscal-platform/mapper', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../src/lib/fiscal-platform/mapper')
  >();
  return { ...actual, buildInvoiceRequest: mocks.buildInvoiceRequest };
});

import {
  emitInvoiceAutomatically,
  emitInvoiceToFiscal,
  retryInvoiceFiscalEmission,
} from '../src/lib/fiscal-platform/emission';
import { FiscalPlatformError } from '../src/lib/fiscal-platform/errors';
import type { Ctx } from '../src/middleware/auth';

const ctx = {
  userId: 'user-1',
  email: 'owner@example.com',
  businessId: 'business-1',
  role: 'owner',
  jwt: 'token',
} satisfies Ctx;

const documentResponse: FiscalDocument = {
  id: 'document-1',
  tenantId: 'tenant-1',
  documentType: 'E31',
  operationMode: 'CLOUD',
  integrationMode: 'JSON',
  externalReference: 'invoice-1',
  status: DocumentStatus.RECEIVED_BY_CLOUD,
  eNCF: 'E310000000001',
  trackId: null,
  correlationId: 'correlation-1',
  source: 'JSON',
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-08-11T12:00:00Z',
  updatedAt: '2026-08-11T12:00:00Z',
  receivedAt: '2026-08-11T12:00:00Z',
  emittedInContingency: false,
  dgiiAttempts: 0,
  dgiiFirstAttemptAt: null,
  deliveryStatus: null,
  receiverTargetUrl: null,
  receiverUrlSource: null,
  deliveryAttempts: 0,
  deliveryDeliveredAt: null,
  deliveryErrorCode: null,
  deliveryErrorMessage: null,
  isManuallyRetriable: false,
};

function record(overrides: Record<string, unknown> = {}) {
  return {
    business: {
      fiscalEnabled: true,
      fiscalDefaultDocumentType: 'E31',
      fiscalDefaultTipoIngresos: '01',
      taxId: '101010632',
      name: 'CRM SRL',
      legalName: null,
      email: null,
      phone: null,
      address: 'Santo Domingo',
      fiscalTradeName: null,
      fiscalBranch: null,
      fiscalEconomicActivity: null,
      fiscalMunicipality: null,
      fiscalProvince: null,
    },
    credentials: {
      fiscalEnabled: true,
      fiscalPlatformTenantId: 'tenant-1',
      fiscalPlatformApiKeyEncrypted: Buffer.from('encrypted'),
      fiscalIntegrationMode: 'JSON',
    },
    invoice: {
      id: 'invoice-1',
      issueDate: '2026-08-11',
      dueDate: null,
      currency: 'DOP',
      subtotal: '100.00',
      discountTotal: '0.00',
      taxTotal: '0.00',
      total: '100.00',
      amountPaid: '0.00',
      balanceDue: '100.00',
    },
    customer: {
      name: 'Customer',
      companyName: null,
      taxId: '00113918205',
      email: null,
      address: null,
      city: null,
    },
    status: 'issued',
    fiscalOptOut: false,
    fiscalMetadata: {},
    createdAt: new Date('2026-08-11T11:00:00Z'),
    fiscalProvisionedAt: new Date('2026-08-10T00:00:00Z'),
    ...overrides,
  };
}

function queueLoad(row = record()) {
  mocks.headerRows.push([row]);
  mocks.itemRows.push([]);
}

describe('fiscal invoice emission', () => {
  beforeEach(() => {
    mocks.headerRows.length = 0;
    mocks.itemRows.length = 0;
    mocks.metadataWrites.length = 0;
    mocks.selectCount = 0;
    mocks.submitInvoice.mockReset();
    mocks.retryDocument.mockReset();
    mocks.buildInvoiceRequest.mockClear();
  });

  it('submits and persists a typed fiscal snapshot', async () => {
    queueLoad();
    mocks.submitInvoice.mockResolvedValue(documentResponse);

    const result = await emitInvoiceToFiscal(ctx, 'invoice-1');

    expect(result).toMatchObject({ attempted: true, outcome: 'submitted' });
    expect(result.metadata).toMatchObject({
      documentId: 'document-1',
      eNcf: 'E310000000001',
      status: DocumentStatus.RECEIVED_BY_CLOUD,
      lastError: null,
    });
    expect(mocks.metadataWrites).toHaveLength(1);
  });

  it('returns the cached snapshot without resubmitting', async () => {
    queueLoad(record({ fiscalMetadata: { documentId: 'document-1' } }));

    const result = await emitInvoiceToFiscal(ctx, 'invoice-1');

    expect(result.outcome).toBe('already_submitted');
    expect(mocks.submitInvoice).not.toHaveBeenCalled();
  });

  it.each([
    ['disabled', { business: { ...record().business, fiscalEnabled: false } }],
    ['opted out', { fiscalOptOut: true }],
    [
      'grandfathered',
      { createdAt: new Date('2026-08-01'), fiscalProvisionedAt: new Date('2026-08-10') },
    ],
  ])('skips automatic emission when the invoice is %s', async (_name, overrides) => {
    queueLoad(record(overrides));

    const result = await emitInvoiceAutomatically(ctx, 'invoice-1');

    expect(result).toEqual({
      attempted: false,
      outcome: 'not_applicable',
      metadata: {},
    });
  });

  it('persists an upstream error and exposes it as 502 for manual emission', async () => {
    queueLoad();
    mocks.submitInvoice.mockRejectedValue(
      new FiscalPlatformError(
        'FISCAL_PLATFORM_UNAVAILABLE',
        503,
        'Unavailable',
        'Servicio fiscal temporalmente no disponible.',
        undefined,
        true,
      ),
    );

    await expect(emitInvoiceToFiscal(ctx, 'invoice-1')).rejects.toMatchObject({
      status: 502,
    });
    expect(mocks.metadataWrites[0]).toMatchObject({
      lastError: { code: 'FISCAL_PLATFORM_UNAVAILABLE' },
    });
  });

  it('keeps automatic issuance successful while reporting fiscal failure', async () => {
    queueLoad();
    queueLoad(
      record({
        fiscalMetadata: {
          lastError: {
            code: 'FISCAL_PLATFORM_UNAVAILABLE',
            message: 'Servicio fiscal temporalmente no disponible.',
          },
        },
      }),
    );
    mocks.submitInvoice.mockRejectedValue(
      new FiscalPlatformError(
        'FISCAL_PLATFORM_UNAVAILABLE',
        503,
        'Unavailable',
        'Servicio fiscal temporalmente no disponible.',
        undefined,
        true,
      ),
    );

    await expect(
      emitInvoiceAutomatically(ctx, 'invoice-1'),
    ).resolves.toMatchObject({
      attempted: true,
      outcome: 'failed',
      metadata: {
        lastError: { code: 'FISCAL_PLATFORM_UNAVAILABLE' },
      },
    });
  });

  it('retries only failed documents and persists the new response', async () => {
    queueLoad(
      record({
        fiscalMetadata: {
          documentId: 'document-1',
          status: DocumentStatus.FAILED,
          submittedAt: '2026-08-11T12:00:00Z',
        },
      }),
    );
    mocks.retryDocument.mockResolvedValue({
      ...documentResponse,
      status: DocumentStatus.QUEUED,
    });

    const result = await retryInvoiceFiscalEmission(ctx, 'invoice-1');

    expect(mocks.retryDocument).toHaveBeenCalledWith('document-1');
    expect(result.metadata).toMatchObject({
      status: DocumentStatus.QUEUED,
      submittedAt: '2026-08-11T12:00:00Z',
      lastError: null,
    });
  });

  it('rejects retry when the fiscal document is not failed', async () => {
    queueLoad(
      record({
        fiscalMetadata: {
          documentId: 'document-1',
          status: DocumentStatus.ACCEPTED,
        },
      }),
    );

    await expect(
      retryInvoiceFiscalEmission(ctx, 'invoice-1'),
    ).rejects.toMatchObject({ status: 409 });
    expect(mocks.retryDocument).not.toHaveBeenCalled();
  });
});
