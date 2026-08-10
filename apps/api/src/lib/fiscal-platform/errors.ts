import type { FiscalStandardApiError } from '@crm/contracts/fiscal';

const USER_MESSAGES: Record<string, string> = {
  AUTH_FAIL: 'Configuración fiscal inválida. Contactar a soporte.',
  NO_ACTIVE_CERTIFICATE:
    'El certificado del emisor no está configurado. Contactar a soporte.',
  ECF_SEQUENCE_UNAVAILABLE:
    'No hay rangos NCF disponibles para este tipo de comprobante. Contactar a soporte.',
  VALIDATION_FAILED: 'Error interno al preparar el comprobante fiscal.',
  XSD_INVALID: 'Error interno al validar el comprobante fiscal.',
  XSD_VALIDATION_FAILED: 'Error interno al validar el comprobante fiscal.',
  CONTINGENCY_15D_EXCEEDED:
    'El servicio fiscal está en contingencia excedida. Contactar a soporte.',
  FISCAL_PLATFORM_UNAVAILABLE:
    'Servicio fiscal temporalmente no disponible. Inténtalo nuevamente más tarde.',
};

export class FiscalPlatformError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number | null,
    public readonly upstreamMessage: string,
    public readonly userMessage: string,
    public readonly details: unknown,
    public readonly retryable: boolean,
  ) {
    super(userMessage);
    this.name = 'FiscalPlatformError';
  }
}

export function mapFiscalPlatformError(
  status: number,
  payload: FiscalStandardApiError | null,
): FiscalPlatformError {
  const upstreamCode = payload?.code;
  const code =
    status === 401
      ? 'AUTH_FAIL'
      : upstreamCode || (status >= 500 ? 'FISCAL_PLATFORM_UNAVAILABLE' : `HTTP_${status}`);
  const upstreamMessage = payload?.message || `fiscal-platform returned HTTP ${status}`;
  const details = payload?.details ?? payload?.errors;
  const userMessage =
    USER_MESSAGES[code] ||
    (status >= 500
      ? USER_MESSAGES.FISCAL_PLATFORM_UNAVAILABLE!
      : 'No se pudo completar la operación fiscal. Contactar a soporte.');

  return new FiscalPlatformError(
    code,
    status,
    upstreamMessage,
    userMessage,
    details,
    status >= 500,
  );
}

export function fiscalNetworkError(cause: unknown): FiscalPlatformError {
  const message = cause instanceof Error ? cause.message : 'Network error';
  return new FiscalPlatformError(
    'FISCAL_PLATFORM_UNAVAILABLE',
    null,
    message,
    USER_MESSAGES.FISCAL_PLATFORM_UNAVAILABLE!,
    undefined,
    true,
  );
}
