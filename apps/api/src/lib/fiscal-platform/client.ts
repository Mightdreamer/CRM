import type {
  FiscalDocument,
  FiscalDocumentListResponse,
  FiscalSequence,
  FiscalStandardApiError,
  InvoiceRequest,
} from '@crm/contracts/fiscal';
import { env } from '../env';
import { decryptApiKey } from './crypto';
import {
  FiscalPlatformError,
  fiscalNetworkError,
  mapFiscalPlatformError,
} from './errors';

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const;

export interface FiscalBusinessCredentials {
  fiscalEnabled: boolean;
  fiscalPlatformTenantId: string | null;
  fiscalPlatformApiKeyEncrypted: Buffer | Uint8Array | null;
  fiscalIntegrationMode: string;
}

export interface ListDocumentsParams {
  status?: string;
  type?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface FiscalClient {
  submitInvoice(payload: InvoiceRequest): Promise<FiscalDocument>;
  getDocument(id: string, includeXml?: boolean): Promise<FiscalDocument>;
  retryDocument(id: string): Promise<FiscalDocument>;
  listDocuments(params?: ListDocumentsParams): Promise<FiscalDocumentListResponse>;
  listSequences(): Promise<FiscalSequence[]>;
}

interface ClientDependencies {
  fetch: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
  baseUrl: string | undefined;
  timeoutMs: number;
}

const defaultDependencies: ClientDependencies = {
  fetch: globalThis.fetch,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  baseUrl: env.FISCAL_PLATFORM_BASE_URL,
  timeoutMs: env.FISCAL_PLATFORM_TIMEOUT_MS,
};

function validateBusiness(business: FiscalBusinessCredentials): void {
  if (!business.fiscalEnabled) {
    throw new FiscalPlatformError(
      'FISCAL_NOT_ENABLED',
      null,
      'Fiscal integration is disabled for this business',
      'La integración fiscal no está habilitada para este negocio.',
      undefined,
      false,
    );
  }
  if (!business.fiscalPlatformTenantId) {
    throw new FiscalPlatformError(
      'FISCAL_NOT_PROVISIONED',
      null,
      'Missing fiscal-platform tenant ID',
      'La configuración fiscal está incompleta. Contactar a soporte.',
      undefined,
      false,
    );
  }
  if (!business.fiscalPlatformApiKeyEncrypted) {
    throw new FiscalPlatformError(
      'FISCAL_NOT_PROVISIONED',
      null,
      'Missing encrypted fiscal-platform API key',
      'La configuración fiscal está incompleta. Contactar a soporte.',
      undefined,
      false,
    );
  }
  if (business.fiscalIntegrationMode !== 'JSON') {
    throw new FiscalPlatformError(
      'FISCAL_MODE_UNSUPPORTED',
      null,
      `Unsupported fiscal integration mode: ${business.fiscalIntegrationMode}`,
      'El modo de integración fiscal configurado todavía no está soportado.',
      undefined,
      false,
    );
  }
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function createFiscalClient(
  business: FiscalBusinessCredentials,
  dependencies: Partial<ClientDependencies> = {},
): FiscalClient {
  validateBusiness(business);
  const deps = { ...defaultDependencies, ...dependencies };

  async function request<T>(
    path: string,
    options: { method?: 'GET' | 'POST'; body?: unknown } = {},
  ): Promise<T> {
    if (!deps.baseUrl) {
      throw new FiscalPlatformError(
        'FISCAL_PLATFORM_NOT_CONFIGURED',
        null,
        'Missing FISCAL_PLATFORM_BASE_URL',
        'El servicio fiscal todavía no está disponible. Contactar a soporte.',
        undefined,
        false,
      );
    }

    let lastNetworkError: unknown;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), deps.timeoutMs);

      try {
        // Deliberately decrypt per operation. Never retain plaintext on the
        // client object or across requests.
        const apiKey = decryptApiKey(
          Buffer.from(business.fiscalPlatformApiKeyEncrypted!),
        );
        const headers: Record<string, string> = {
          Accept: 'application/json',
          Authorization: `Bearer ${apiKey}`,
        };
        if (options.body !== undefined) {
          headers['Content-Type'] = 'application/json';
        }

        const response = await deps.fetch(`${deps.baseUrl}${path}`, {
          method: options.method ?? 'GET',
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: controller.signal,
        });
        const payload = await parseJson(response);

        if (response.ok) return payload as T;

        if (response.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
          await deps.sleep(RETRY_DELAYS_MS[attempt]!);
          continue;
        }

        throw mapFiscalPlatformError(
          response.status,
          payload as FiscalStandardApiError | null,
        );
      } catch (error) {
        if (error instanceof FiscalPlatformError) throw error;
        lastNetworkError = error;
        if (attempt < RETRY_DELAYS_MS.length) {
          await deps.sleep(RETRY_DELAYS_MS[attempt]!);
          continue;
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw fiscalNetworkError(lastNetworkError);
  }

  return {
    submitInvoice: (payload) =>
      request<FiscalDocument>('/api/v1/invoices', {
        method: 'POST',
        body: payload,
      }),
    getDocument: (id, includeXml = false) =>
      request<FiscalDocument>(
        `/api/v1/documents/${encodeURIComponent(id)}${includeXml ? '?include=xml' : ''}`,
      ),
    retryDocument: (id) =>
      request<FiscalDocument>(
        `/api/v1/documents/${encodeURIComponent(id)}/retry`,
        { method: 'POST' },
      ),
    listDocuments: (params = {}) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) query.set(key, String(value));
      }
      const suffix = query.size > 0 ? `?${query.toString()}` : '';
      return request<FiscalDocumentListResponse>(`/api/v1/documents${suffix}`);
    },
    listSequences: () =>
      request<FiscalSequence[]>('/api/v1/ecf-sequences'),
  };
}
