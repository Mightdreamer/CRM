'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireBusiness } from '@/lib/auth/session';
import * as api from '@/lib/api/invoices';
import { invoiceSchema, type InvoiceInput } from '@crm/contracts/invoice';
import { paymentSchema } from '@crm/contracts/payment';

export type InvoiceActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function parseFormData(formData: FormData): InvoiceInput | { _error: InvoiceActionResult } {
  let items: unknown;
  try {
    items = JSON.parse(String(formData.get('items') ?? '[]'));
  } catch {
    return { _error: { ok: false, error: 'Invalid items payload.' } };
  }
  const raw = {
    customer_id: formData.get('customer_id'),
    issue_date: formData.get('issue_date'),
    due_date: formData.get('due_date'),
    notes: formData.get('notes'),
    terms: formData.get('terms'),
    currency: formData.get('currency') || 'DOP',
    fiscal_opt_out: formData.get('fiscal_opt_out') === 'on',
    quotation_id: formData.get('quotation_id'),
    items,
  };
  const parsed = invoiceSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      _error: {
        ok: false,
        error: 'Validation failed',
        fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
      },
    };
  }
  return parsed.data;
}

export async function createInvoice(
  _prev: InvoiceActionResult | null,
  formData: FormData,
): Promise<InvoiceActionResult> {
  await requireBusiness();
  const parsed = parseFormData(formData);
  if ('_error' in parsed) return parsed._error;

  const res = await api.createInvoice(parsed);
  if (!res.ok) return { ok: false, error: res.error, fieldErrors: res.fieldErrors };

  revalidatePath('/invoices');
  redirect(`/invoices/${res.data.id}`);
}

export async function updateInvoice(
  id: string,
  _prev: InvoiceActionResult | null,
  formData: FormData,
): Promise<InvoiceActionResult> {
  await requireBusiness();
  const parsed = parseFormData(formData);
  if ('_error' in parsed) return parsed._error;

  const res = await api.updateInvoice(id, parsed);
  if (!res.ok) return { ok: false, error: res.error, fieldErrors: res.fieldErrors };

  revalidatePath('/invoices');
  revalidatePath(`/invoices/${id}`);
  redirect(`/invoices/${id}`);
}

export async function changeInvoiceStatus(id: string, target: 'issued' | 'cancelled' | 'draft') {
  await requireBusiness();
  const res = await api.changeInvoiceStatus(id, target);
  if (!res.ok) throw new Error(res.error);
  revalidatePath('/invoices');
  revalidatePath(`/invoices/${id}`);
}

export async function deleteInvoice(id: string) {
  await requireBusiness();
  const res = await api.deleteInvoice(id);
  if (!res.ok) throw new Error(res.error);
  revalidatePath('/invoices');
}

export type PaymentActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export async function addPayment(
  _prev: PaymentActionResult | null,
  formData: FormData,
): Promise<PaymentActionResult> {
  await requireBusiness();
  const parsed = paymentSchema.safeParse({
    invoice_id: formData.get('invoice_id'),
    payment_date: formData.get('payment_date'),
    amount: formData.get('amount'),
    method: formData.get('method'),
    reference: formData.get('reference'),
    notes: formData.get('notes'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Validation failed',
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const { invoice_id, ...rest } = parsed.data;
  const res = await api.addPayment(invoice_id, rest);
  if (!res.ok) return { ok: false, error: res.error, fieldErrors: res.fieldErrors };

  revalidatePath(`/invoices/${invoice_id}`);
  return { ok: true };
}

export async function deletePayment(invoiceId: string, paymentId: string) {
  await requireBusiness();
  const res = await api.deletePayment(invoiceId, paymentId);
  if (!res.ok) throw new Error(res.error);
  revalidatePath(`/invoices/${invoiceId}`);
}
