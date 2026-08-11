import 'server-only';
import type {
  NumberingInput,
  PdfSettingsInput,
  ProfileInput,
  TaxSettingsInput,
} from '@crm/contracts/settings';
import {
  apiDelete,
  apiFetch,
  apiGet,
  apiPatch,
  apiPostForm,
  type ApiResult,
} from '../api-client';

/**
 * Shape of the businesses table row returned by GET /v1/settings.
 * Mirrors the columns selected by the previous Supabase query in
 * apps/web/src/app/(app)/settings/page.tsx.
 */
export type SettingsRow = {
  id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  logo_url: string | null;
  default_currency: string;
  default_tax_rate: string;
  default_payment_terms_days: number;
  invoice_prefix: string;
  invoice_next_number: number;
  quotation_prefix: string;
  quotation_next_number: number;
  pdf_settings: {
    primary_color?: string;
    footer_text?: string;
    show_logo?: boolean;
  } | null;
  fiscal_enabled: boolean;
};

// Drizzle returns camelCase columns; the api now returns a row whose
// keys match the Drizzle field names. Map them back to the snake_case
// shape the existing UI components consume.
type DrizzleSettingsRow = {
  id: string;
  name: string;
  legalName: string | null;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  logoUrl: string | null;
  defaultCurrency: string;
  defaultTaxRate: string;
  defaultPaymentTermsDays: number;
  invoicePrefix: string;
  invoiceNextNumber: number;
  quotationPrefix: string;
  quotationNextNumber: number;
  pdfSettings: SettingsRow['pdf_settings'];
  fiscalEnabled: boolean;
};

function camelToSnake(row: DrizzleSettingsRow): SettingsRow {
  return {
    id: row.id,
    name: row.name,
    legal_name: row.legalName,
    tax_id: row.taxId,
    email: row.email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    country: row.country,
    logo_url: row.logoUrl,
    default_currency: row.defaultCurrency,
    default_tax_rate: row.defaultTaxRate,
    default_payment_terms_days: row.defaultPaymentTermsDays,
    invoice_prefix: row.invoicePrefix,
    invoice_next_number: row.invoiceNextNumber,
    quotation_prefix: row.quotationPrefix,
    quotation_next_number: row.quotationNextNumber,
    pdf_settings: row.pdfSettings,
    fiscal_enabled: row.fiscalEnabled,
  };
}

export async function getSettings(): Promise<ApiResult<SettingsRow>> {
  const res = await apiGet<DrizzleSettingsRow>('/v1/settings');
  if (!res.ok) return res;
  return { ok: true, data: camelToSnake(res.data) };
}

export const updateProfile = (input: ProfileInput) =>
  apiPatch<{ updated: true }>('/v1/settings/profile', input);

export const updateTaxSettings = (input: TaxSettingsInput) =>
  apiPatch<{ updated: true }>('/v1/settings/tax', input);

export const updateNumbering = (input: NumberingInput) =>
  apiPatch<{ updated: true }>('/v1/settings/numbering', input);

export const updatePdfSettings = (input: PdfSettingsInput) =>
  apiPatch<{ updated: true }>('/v1/settings/pdf', input);

export const uploadLogo = (file: File) => {
  const form = new FormData();
  form.append('logo', file);
  return apiPostForm<{ logo_url: string }>('/v1/settings/logo', form);
};

export const removeLogo = () =>
  apiDelete<undefined>('/v1/settings/logo');
