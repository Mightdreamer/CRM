import 'server-only';
import type {
  Quotation,
  QuotationInput,
  QuotationItem,
  QuotationStatus,
} from '@crm/contracts/quotation';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, type ApiResult } from '../api-client';

export type QuotationListRow = {
  id: string;
  quotation_number: string;
  issue_date: string;
  expiry_date: string | null;
  status: QuotationStatus;
  total: string;
  currency: string;
  customer: { name: string; company_name: string | null } | null;
};

export type QuotationList = {
  rows: QuotationListRow[];
  count: number;
  page: number;
  size: number;
};

type DrizzleQuotation = {
  id: string;
  businessId: string;
  customerId: string;
  quotationNumber: string;
  issueDate: string;
  expiryDate: string | null;
  status: QuotationStatus;
  notes: string | null;
  terms: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  currency: string;
  convertedInvoiceId: string | null;
  deletedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type DrizzleQuotationItem = {
  id: string;
  quotationId: string;
  productId: string | null;
  productName: string;
  description: string | null;
  quantity: string;
  unitPrice: string;
  discountPct: string;
  taxRate: string;
  lineSubtotal: string;
  lineTax: string;
  lineTotal: string;
  sortOrder: number;
};

function quotationFromDrizzle(row: DrizzleQuotation): Quotation {
  return {
    id: row.id,
    business_id: row.businessId,
    customer_id: row.customerId,
    quotation_number: row.quotationNumber,
    issue_date: row.issueDate,
    expiry_date: row.expiryDate,
    status: row.status,
    notes: row.notes,
    terms: row.terms,
    subtotal: Number(row.subtotal),
    discount_total: Number(row.discountTotal),
    tax_total: Number(row.taxTotal),
    total: Number(row.total),
    currency: row.currency,
    converted_invoice_id: row.convertedInvoiceId,
    deleted_at: row.deletedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function itemFromDrizzle(row: DrizzleQuotationItem): QuotationItem {
  return {
    id: row.id,
    quotation_id: row.quotationId,
    product_id: row.productId,
    product_name: row.productName,
    description: row.description,
    quantity: Number(row.quantity),
    unit_price: Number(row.unitPrice),
    discount_pct: Number(row.discountPct),
    tax_rate: Number(row.taxRate),
    line_subtotal: Number(row.lineSubtotal),
    line_tax: Number(row.lineTax),
    line_total: Number(row.lineTotal),
    sort_order: row.sortOrder,
  };
}

export async function listQuotations(params: {
  q?: string;
  status?: QuotationStatus;
  page?: number;
  size?: number;
  availableForInvoice?: boolean;
}): Promise<ApiResult<QuotationList>> {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.status) sp.set('status', params.status);
  if (params.page) sp.set('page', String(params.page));
  if (params.size) sp.set('size', String(params.size));
  if (params.availableForInvoice) sp.set('available_for_invoice', 'true');
  const qs = sp.toString();
  return apiGet<QuotationList>(`/v1/quotations${qs ? `?${qs}` : ''}`);
}

export type QuotationDetail = {
  quotation: Quotation;
  customer: {
    name: string;
    company_name: string | null;
    email: string | null;
    tax_id: string | null;
  };
  items: QuotationItem[];
};

export async function getQuotation(id: string): Promise<ApiResult<QuotationDetail>> {
  type Raw = {
    quotation: DrizzleQuotation;
    customer: QuotationDetail['customer'];
    items: DrizzleQuotationItem[];
  };
  const res = await apiGet<Raw>(`/v1/quotations/${id}`);
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      quotation: quotationFromDrizzle(res.data.quotation),
      customer: res.data.customer,
      items: res.data.items.map(itemFromDrizzle),
    },
  };
}

export const createQuotation = (input: QuotationInput) =>
  apiPost<{ id: string; quotation_number: string }>('/v1/quotations', input);

export const updateQuotation = (id: string, input: QuotationInput) =>
  apiPut<{ id: string }>(`/v1/quotations/${id}`, input);

export const changeQuotationStatus = (id: string, status: QuotationStatus) =>
  apiPatch<undefined>(`/v1/quotations/${id}/status`, { status });

export const deleteQuotation = (id: string) =>
  apiDelete<undefined>(`/v1/quotations/${id}`);

export const convertQuotationToInvoice = (id: string) =>
  apiPost<{ id: string; invoice_number: string }>(`/v1/quotations/${id}/convert`);
