import 'server-only';
import type {
  Invoice,
  InvoiceInput,
  InvoiceItem,
  InvoiceStatus,
} from '@crm/contracts/invoice';
import type {
  FiscalEmissionResult,
  FiscalMetadataSnapshot,
} from '@crm/contracts/fiscal';
import type { PaymentInput, Payment } from '@crm/contracts/payment';
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  type ApiResult,
} from '../api-client';

export type InvoiceListRow = {
  id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  status: InvoiceStatus;
  total: string;
  balance_due: string;
  currency: string;
  customer: { name: string; company_name: string | null } | null;
};

export type InvoiceList = {
  rows: InvoiceListRow[];
  count: number;
  page: number;
  size: number;
};

type DrizzleInvoice = {
  id: string;
  businessId: string;
  customerId: string;
  quotationId: string | null;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string | null;
  status: InvoiceStatus;
  notes: string | null;
  terms: string | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  amountPaid: string;
  balanceDue: string;
  currency: string;
  fiscalMetadata: Record<string, unknown>;
  fiscalOptOut: boolean;
  deletedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

type DrizzleInvoiceItem = {
  id: string;
  invoiceId: string;
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

function invoiceFromDrizzle(row: DrizzleInvoice): Invoice {
  return {
    id: row.id,
    business_id: row.businessId,
    customer_id: row.customerId,
    quotation_id: row.quotationId,
    invoice_number: row.invoiceNumber,
    issue_date: row.issueDate,
    due_date: row.dueDate,
    status: row.status,
    notes: row.notes,
    terms: row.terms,
    subtotal: Number(row.subtotal),
    discount_total: Number(row.discountTotal),
    tax_total: Number(row.taxTotal),
    total: Number(row.total),
    amount_paid: Number(row.amountPaid),
    balance_due: Number(row.balanceDue),
    currency: row.currency,
    fiscal_metadata: row.fiscalMetadata,
    fiscal_opt_out: row.fiscalOptOut,
    deleted_at: row.deletedAt,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  };
}

function itemFromDrizzle(row: DrizzleInvoiceItem): InvoiceItem {
  return {
    id: row.id,
    invoice_id: row.invoiceId,
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

export async function listInvoices(params: {
  q?: string;
  status?: InvoiceStatus;
  page?: number;
  size?: number;
}): Promise<ApiResult<InvoiceList>> {
  const sp = new URLSearchParams();
  if (params.q) sp.set('q', params.q);
  if (params.status) sp.set('status', params.status);
  if (params.page) sp.set('page', String(params.page));
  if (params.size) sp.set('size', String(params.size));
  const qs = sp.toString();
  return apiGet<InvoiceList>(`/v1/invoices${qs ? `?${qs}` : ''}`);
}

export type InvoiceDetail = {
  invoice: Invoice;
  customer: {
    name: string;
    company_name: string | null;
    email: string | null;
    tax_id: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
  };
  quotation_number: string | null;
  items: InvoiceItem[];
  payments: Pick<Payment, 'id' | 'payment_date' | 'amount' | 'method' | 'reference' | 'notes'>[];
};

export async function getInvoice(id: string): Promise<ApiResult<InvoiceDetail>> {
  type Raw = {
    invoice: DrizzleInvoice;
    customer: InvoiceDetail['customer'];
    quotation_number: string | null;
    items: DrizzleInvoiceItem[];
    payments: {
      id: string;
      payment_date: string;
      amount: string;
      method: string;
      reference: string | null;
      notes: string | null;
    }[];
  };
  const res = await apiGet<Raw>(`/v1/invoices/${id}`);
  if (!res.ok) return res;
  return {
    ok: true,
    data: {
      invoice: invoiceFromDrizzle(res.data.invoice),
      customer: res.data.customer,
      quotation_number: res.data.quotation_number,
      items: res.data.items.map(itemFromDrizzle),
      payments: res.data.payments.map((p) => ({
        id: p.id,
        payment_date: p.payment_date,
        amount: Number(p.amount),
        method: p.method as Payment['method'],
        reference: p.reference,
        notes: p.notes,
      })),
    },
  };
}

export const createInvoice = (input: InvoiceInput) =>
  apiPost<{ id: string; invoice_number: string }>('/v1/invoices', input);

export const updateInvoice = (id: string, input: InvoiceInput) =>
  apiPut<{ id: string }>(`/v1/invoices/${id}`, input);

export const changeInvoiceStatus = (id: string, status: 'draft' | 'issued' | 'cancelled') =>
  apiPatch<{ status: InvoiceStatus; fiscal: FiscalEmissionResult }>(
    `/v1/invoices/${id}/status`,
    { status },
  );

export const emitInvoiceFiscal = (id: string) =>
  apiPost<FiscalMetadataSnapshot>(`/v1/invoices/${id}/emit-ecf`);

export const retryInvoiceFiscal = (id: string) =>
  apiPost<FiscalMetadataSnapshot>(`/v1/invoices/${id}/retry-ecf`);

export const deleteInvoice = (id: string) =>
  apiDelete<undefined>(`/v1/invoices/${id}`);

export const addPayment = (invoiceId: string, input: Omit<PaymentInput, 'invoice_id'>) =>
  apiPost<undefined>(`/v1/invoices/${invoiceId}/payments`, input);

export const deletePayment = (invoiceId: string, paymentId: string) =>
  apiDelete<undefined>(`/v1/invoices/${invoiceId}/payments/${paymentId}`);
