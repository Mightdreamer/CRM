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
