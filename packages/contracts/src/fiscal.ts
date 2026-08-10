import { z } from 'zod';

// Optional string that also treats "" as undefined (matches settings.ts style).
const optionalText = (max = 255) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .or(z.literal('').transform(() => undefined));

// ---------------------------------------------------------------------
// Staff-only provisioning (PATCH /v1/admin/businesses/:id/fiscal-provisioning)
//
// Every field is optional so staff can send partial updates:
//   * Only paste the API key when rotating.
//   * Only touch fiscal_enabled to flip the switch.
// The endpoint enforces coherence: activation requires tenant + key +
// business.tax_id that passes DGII RNC validation (via @crm/core/dgii).
// The plaintext api_key is never echoed back to the client — only the
// hint (see api_key_hint in the business row).
// ---------------------------------------------------------------------
export const businessFiscalProvisioningSchema = z.object({
  tenant_id: z
    .string()
    .trim()
    .uuid('tenant_id must be a UUID')
    .optional(),
  api_key: z
    .string()
    .trim()
    .min(20, 'API key looks too short')
    .max(200)
    .regex(/^fpk_/, 'API key must start with `fpk_`')
    .optional(),
  fiscal_enabled: z.boolean().optional(),
  fiscal_integration_mode: z.enum(['JSON', 'XML']).optional(),
});
export type BusinessFiscalProvisioningInput = z.infer<
  typeof businessFiscalProvisioningSchema
>;

// Fiscal-platform document types this integration supports. E34 (credit
// note) is post-MVP — see docs/FISCAL_INTEGRATION_PLAN.md Fase J.
export const fiscalDocumentTypes = ['E31', 'E32'] as const;
export type FiscalDocumentType = (typeof fiscalDocumentTypes)[number];

// TipoIngresos codes accepted by the fiscal-platform contract.
// "01" (ventas) is the default for most CRM invoices.
export const fiscalTipoIngresosCodes = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
] as const;
export type FiscalTipoIngresos = (typeof fiscalTipoIngresosCodes)[number];

// ---------------------------------------------------------------------
// Owner-editable Emisor metadata (PATCH /v1/settings/fiscal)
//
// Only available when business.fiscal_enabled = true — the endpoint
// returns 403 otherwise. All fields shape the `Emisor` block of the
// e-CF payload built in Fase C.
// ---------------------------------------------------------------------
export const businessFiscalSettingsSchema = z.object({
  default_document_type: z.enum(fiscalDocumentTypes),
  default_tipo_ingresos: z.enum(fiscalTipoIngresosCodes),
  trade_name: optionalText(200),
  branch: optionalText(100),
  economic_activity: optionalText(200),
  municipality: optionalText(100),
  province: optionalText(100),
});
export type BusinessFiscalSettingsInput = z.infer<
  typeof businessFiscalSettingsSchema
>;

// ---------------------------------------------------------------------
// fiscal-platform Cloud API wire contracts
//
// Vendored from @fiscal-platform/shared-contracts and the Cloud API DTOs at
// fiscal-platform commit 5f4aa80633ad96f89791db61cb12a696fe2c6274.
// The upstream package is private and outside this repository's Docker build
// context, so a file/workspace dependency would not be deployable on Railway.
// Keep these shapes in sync before changing the integration.
// ---------------------------------------------------------------------

export enum DocumentType {
  E31 = 'E31',
  E32 = 'E32',
  E34 = 'E34',
}

export enum OperationMode {
  LOCAL = 'LOCAL',
  CLOUD = 'CLOUD',
}

export enum IntegrationMode {
  JSON = 'JSON',
  XML = 'XML',
}

export enum TipoPago {
  Contado = 1,
  Credito = 2,
  Gratuito = 3,
}

export enum IndicadorFacturacion {
  NoFacturable = 0,
  Itbis18 = 1,
  Itbis16 = 2,
  Itbis0 = 3,
  Exento = 4,
}

export enum IndicadorBienoServicio {
  Bien = 1,
  Servicio = 2,
}

export enum DocumentStatus {
  DRAFT_RECEIVED = 'DRAFT_RECEIVED',
  XML_GENERATED = 'XML_GENERATED',
  XML_RECEIVED = 'XML_RECEIVED',
  XSD_VALIDATED = 'XSD_VALIDATED',
  SIGNED = 'SIGNED',
  QUEUED = 'QUEUED',
  SENT_TO_CLOUD = 'SENT_TO_CLOUD',
  RECEIVED_BY_CLOUD = 'RECEIVED_BY_CLOUD',
  AUTHENTICATED_WITH_DGII = 'AUTHENTICATED_WITH_DGII',
  SENT_TO_DGII = 'SENT_TO_DGII',
  TRACK_ID_RECEIVED = 'TRACK_ID_RECEIVED',
  ACCEPTED = 'ACCEPTED',
  REJECTED = 'REJECTED',
  CONDITIONAL_ACCEPTED = 'CONDITIONAL_ACCEPTED',
  IN_PROCESS = 'IN_PROCESS',
  CONTINGENCY_PENDING = 'CONTINGENCY_PENDING',
  FAILED = 'FAILED',
}

export interface FiscalIdDoc {
  version: string;
  tipoeCF: DocumentType;
  eNCF?: string;
  fechaVencimientoSecuencia?: string;
  indicadorMontoGravado?: number;
  tipoIngresos?: FiscalTipoIngresos;
  tipoPago: TipoPago;
  fechaLimitePago?: string;
}

export interface FiscalEmisor {
  rncEmisor: string;
  razonSocialEmisor: string;
  nombreComercial?: string;
  sucursal?: string;
  direccionEmisor: string;
  municipio?: string;
  provincia?: string;
  telefonosEmisor?: string[];
  correoEmisor?: string;
  actividadEconomica?: string;
  fechaEmision: string;
}

export interface FiscalComprador {
  rncComprador?: string;
  razonSocialComprador?: string;
  correoComprador?: string;
  direccionComprador?: string;
  municipioComprador?: string;
  provinciaComprador?: string;
}

export interface FiscalItem {
  numeroLinea: number;
  indicadorFacturacion: IndicadorFacturacion;
  nombreItem: string;
  indicadorBienoServicio: IndicadorBienoServicio;
  descripcionItem?: string;
  cantidadItem: string;
  precioUnitarioItem: string;
  descuentoMonto?: string;
  recargoMonto?: string;
  montoItem: string;
}

export interface FiscalTotales {
  montoGravadoTotal?: string;
  montoGravadoI1?: string;
  montoGravadoI2?: string;
  montoGravadoI3?: string;
  montoExento?: string;
  itbis1?: number;
  itbis2?: number;
  itbis3?: number;
  totalITBIS?: string;
  totalITBIS1?: string;
  totalITBIS2?: string;
  totalITBIS3?: string;
  montoTotal: string;
  montoNoFacturable?: string;
  montoAvancePago?: string;
  valorPagar?: string;
}

interface BaseInvoiceRequest {
  documentType: DocumentType;
  operationMode: OperationMode;
  integrationMode: IntegrationMode;
  externalReference?: string;
  idDoc: FiscalIdDoc;
  emisor: FiscalEmisor;
  comprador?: FiscalComprador;
  items: FiscalItem[];
  totales: FiscalTotales;
}

export interface E31InvoiceRequest extends BaseInvoiceRequest {
  documentType: DocumentType.E31;
  comprador: FiscalComprador & {
    rncComprador: string;
    razonSocialComprador: string;
  };
}

export interface E32InvoiceRequest extends BaseInvoiceRequest {
  documentType: DocumentType.E32;
}

export interface E34CreditNoteRequest extends BaseInvoiceRequest {
  documentType: DocumentType.E34;
  informacionReferencia: {
    ncfModificado: string;
    rncOtroContribuyente?: string;
    fechaNCFModificado: string;
    codigoModificacion: 1 | 2 | 3 | 4;
    razonModificacion?: string;
  };
}

export type InvoiceRequest =
  | E31InvoiceRequest
  | E32InvoiceRequest
  | E34CreditNoteRequest;

export interface FiscalDocument {
  id: string;
  tenantId: string;
  documentType: string;
  operationMode: string;
  integrationMode: string;
  externalReference: string | null;
  status: DocumentStatus;
  eNCF: string | null;
  trackId: string | null;
  correlationId: string;
  source: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  receivedAt: string;
  emittedInContingency: boolean;
  dgiiAttempts: number;
  dgiiFirstAttemptAt: string | null;
  deliveryStatus: string | null;
  receiverTargetUrl: string | null;
  receiverUrlSource: string | null;
  deliveryAttempts: number;
  deliveryDeliveredAt: string | null;
  deliveryErrorCode: string | null;
  deliveryErrorMessage: string | null;
  isManuallyRetriable: boolean;
  xmlSigned?: string;
}

export interface FiscalDocumentListItem {
  id: string;
  eNcf: string | null;
  documentType: string;
  status: DocumentStatus;
  createdAt: string;
  externalReference: string | null;
  trackId: string | null;
  errorCode: string | null;
}

export interface FiscalDocumentListResponse {
  items: FiscalDocumentListItem[];
  nextCursor: string | null;
}

export interface FiscalSequence {
  id: string;
  tenantId: string;
  documentType: string;
  rangeFrom: number;
  rangeTo: number;
  nextNumber: number;
  used: number;
  remaining: number;
  percentConsumed: number;
  expiryDate: string;
  daysToExpiry: number;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FiscalStandardApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  errors?: unknown;
  statusCode?: number;
}
