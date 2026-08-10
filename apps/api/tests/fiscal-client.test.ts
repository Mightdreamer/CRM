import type {
  FiscalDocument,
  InvoiceRequest,
} from '@crm/contracts/fiscal';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encryptApiKey } from '../src/lib/fiscal-platform/crypto';
import {
  createFiscalClient,
  type FiscalBusinessCredentials,
} from '../src/lib/fiscal-platform/client';
import { FiscalPlatformError } from '../src/lib/fiscal-platform/errors';

const baseUrl = 'https://fiscal.example.test';

const documentResponse: FiscalDocument = {
  id: 'doc-1',
  tenantId: 'tenant-1',
  documentType: 'E31',
  operationMode: 'CLOUD',
  integrationMode: 'JSON',
  externalReference: 'invoice-1',
  status: 'RECEIVED_BY_CLOUD' as FiscalDocument['status'],
  eNCF: 'E310000000001',
  trackId: null,
  correlationId: 'correlation-1',
  source: 'JSON',
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-08-10T00:00:00Z',
  updatedAt: '2026-08-10T00:00:00Z',
  receivedAt: '2026-08-10T00:00:00Z',
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

function business(apiKey = 'fpk_test_secret_ab12'): FiscalBusinessCredentials {
  return {
    fiscalEnabled: true,
    fiscalPlatformTenantId: 'tenant-1',
    fiscalPlatformApiKeyEncrypted: encryptApiKey(apiKey),
    fiscalIntegrationMode: 'JSON',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function clientWith(fetchMock: typeof fetch, target = business()) {
  return createFiscalClient(target, {
    fetch: fetchMock,
    sleep: vi.fn().mockResolvedValue(undefined),
    baseUrl,
    timeoutMs: 50,
  });
}

describe('fiscal-platform client', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('calls every operation with the expected method, URL and headers', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(documentResponse, 201))
      .mockResolvedValueOnce(jsonResponse(documentResponse))
      .mockResolvedValueOnce(jsonResponse(documentResponse))
      .mockResolvedValueOnce(jsonResponse({ items: [], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse([]));
    const client = clientWith(fetchMock);
    const payload = { documentType: 'E31' } as InvoiceRequest;

    await client.submitInvoice(payload);
    await client.getDocument('doc/1', true);
    await client.retryDocument('doc/1');
    await client.listDocuments({
      status: 'FAILED',
      type: 'E31',
      from: '2026-08-01',
      to: '2026-08-10',
      limit: 10,
      cursor: 'next cursor',
    });
    await client.listSequences();

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${baseUrl}/api/v1/invoices`);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify(payload),
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Accept: 'application/json',
      Authorization: 'Bearer fpk_test_secret_ab12',
      'Content-Type': 'application/json',
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `${baseUrl}/api/v1/documents/doc%2F1?include=xml`,
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      `${baseUrl}/api/v1/documents/doc%2F1/retry`,
    );
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe('POST');
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain(
      'cursor=next+cursor',
    );
    expect(fetchMock.mock.calls[4]?.[0]).toBe(
      `${baseUrl}/api/v1/ecf-sequences`,
    );
  });

  it('decrypts the current ciphertext for each operation', async () => {
    const target = business('fpk_first_secret_1111');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse([]));
    const client = clientWith(fetchMock, target);

    await client.listSequences();
    target.fiscalPlatformApiKeyEncrypted = encryptApiKey('fpk_second_secret_2222');
    await client.listSequences();

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer fpk_first_secret_1111',
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      Authorization: 'Bearer fpk_second_secret_2222',
    });
  });

  it('retries 5xx with 1s/2s/4s backoff and accepts the fourth response', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ code: 'DOWN', message: 'down' }, 503))
      .mockResolvedValueOnce(jsonResponse({ code: 'DOWN', message: 'down' }, 503))
      .mockResolvedValueOnce(jsonResponse({ code: 'DOWN', message: 'down' }, 500))
      .mockResolvedValueOnce(jsonResponse([]));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = createFiscalClient(business(), {
      fetch: fetchMock,
      sleep,
      baseUrl,
      timeoutMs: 50,
    });

    await expect(client.listSequences()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls).toEqual([[1_000], [2_000], [4_000]]);
  });

  it('retries network failures and reports exhaustion safely', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('socket down'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = createFiscalClient(business(), {
      fetch: fetchMock,
      sleep,
      baseUrl,
      timeoutMs: 50,
    });

    const error = await client.listSequences().catch((caught) => caught);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(error).toBeInstanceOf(FiscalPlatformError);
    expect(error).toMatchObject({
      code: 'FISCAL_PLATFORM_UNAVAILABLE',
      retryable: true,
    });
    expect(JSON.stringify(error)).not.toContain('fpk_test_secret');
  });

  it('times out each attempt and retries', async () => {
    const fetchMock = vi.fn<typeof fetch>((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        );
      }),
    );
    const client = createFiscalClient(business(), {
      fetch: fetchMock,
      sleep: vi.fn().mockResolvedValue(undefined),
      baseUrl,
      timeoutMs: 2,
    });

    await expect(client.listSequences()).rejects.toMatchObject({
      code: 'FISCAL_PLATFORM_UNAVAILABLE',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([
    [401, { code: 'Unauthorized', message: 'REVOKED' }, 'AUTH_FAIL'],
    [412, { code: 'NO_ACTIVE_CERTIFICATE', message: 'missing' }, 'NO_ACTIVE_CERTIFICATE'],
    [412, { code: 'ECF_SEQUENCE_UNAVAILABLE', message: 'empty' }, 'ECF_SEQUENCE_UNAVAILABLE'],
    [400, { code: 'VALIDATION_FAILED', message: 'invalid' }, 'VALIDATION_FAILED'],
    [422, { code: 'XSD_VALIDATION_FAILED', message: 'invalid xml' }, 'XSD_VALIDATION_FAILED'],
    [451, { code: 'CONTINGENCY_15D_EXCEEDED', message: 'late' }, 'CONTINGENCY_15D_EXCEEDED'],
  ])('maps HTTP %s errors without retry', async (status, payload, code) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(payload, status));
    const client = clientWith(fetchMock);

    await expect(client.listSequences()).rejects.toMatchObject({ code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('handles non-JSON errors and unknown 4xx safely', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('not-json', { status: 418 }));
    const client = clientWith(fetchMock);

    await expect(client.listSequences()).rejects.toMatchObject({
      code: 'HTTP_418',
      status: 418,
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ ...business(), fiscalEnabled: false }, 'FISCAL_NOT_ENABLED'],
    [{ ...business(), fiscalPlatformTenantId: null }, 'FISCAL_NOT_PROVISIONED'],
    [{ ...business(), fiscalPlatformApiKeyEncrypted: null }, 'FISCAL_NOT_PROVISIONED'],
    [{ ...business(), fiscalIntegrationMode: 'XML' }, 'FISCAL_MODE_UNSUPPORTED'],
  ])('rejects invalid provisioning before network access', (target, code) => {
    expect(() => clientWith(vi.fn<typeof fetch>(), target)).toThrowError(
      expect.objectContaining({ code }),
    );
  });
});
