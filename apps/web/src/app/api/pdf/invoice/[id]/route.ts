import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { getTranslations } from 'next-intl/server';
import { requireBusiness } from '@/lib/auth/session';
import { getInvoice } from '@/lib/api/invoices';
import { getSettings } from '@/lib/api/settings';
import { InvoicePDF } from '@/lib/pdf/InvoicePDF';

export const runtime = 'nodejs';

/**
 * PDF rendering stays on web for Phase 2 — i18n labels come from
 * next-intl which is web-only. The data is loaded via the api client
 * (no direct Supabase). @react-pdf/renderer keeps living in
 * apps/web/package.json; moving it to apps/api with a binary proxy is
 * deferred to a later phase if it becomes a bottleneck.
 */
export async function GET(_req: Request, ctxParams: RouteContext<'/api/pdf/invoice/[id]'>) {
  const { id } = await ctxParams.params;
  await requireBusiness();
  const t = await getTranslations('invoices');
  const tq = await getTranslations('quotations');

  const [invoiceRes, settingsRes] = await Promise.all([
    getInvoice(id),
    getSettings(),
  ]);
  if (!invoiceRes.ok) {
    return new NextResponse(invoiceRes.error, {
      status: invoiceRes.error.includes('not found') ? 404 : 500,
    });
  }
  if (!settingsRes.ok) {
    return new NextResponse(settingsRes.error, { status: 500 });
  }
  const { invoice: inv, customer, items } = invoiceRes.data;
  const b = settingsRes.data;

  const business = {
    name: b.name,
    legal_name: b.legal_name,
    tax_id: b.tax_id,
    email: b.email,
    phone: b.phone,
    address: b.address,
    city: b.city,
    country: b.country,
    logo_url: b.logo_url,
    pdf_settings: b.pdf_settings,
  };

  const buffer = await renderToBuffer(
    InvoicePDF({
      business: business as Parameters<typeof InvoicePDF>[0]['business'],
      customer,
      invoice: {
        invoice_number: inv.invoice_number,
        issue_date: inv.issue_date,
        due_date: inv.due_date,
        status: inv.status,
        notes: inv.notes,
        terms: inv.terms,
        subtotal: Number(inv.subtotal),
        discount_total: Number(inv.discount_total),
        tax_total: Number(inv.tax_total),
        total: Number(inv.total),
        amount_paid: Number(inv.amount_paid),
        balance_due: Number(inv.balance_due),
        currency: inv.currency,
      },
      items: items.map((it) => ({
        product_name: it.product_name,
        description: it.description,
        quantity: Number(it.quantity),
        unit_price: Number(it.unit_price),
        discount_pct: Number(it.discount_pct),
        tax_rate: Number(it.tax_rate),
        line_total: Number(it.line_total),
      })),
      labels: {
        documentTitle: t('title').toUpperCase(),
        issueDate: t('fields.issueDate'),
        dueDate: t('fields.dueDate'),
        billTo: t('fields.customer'),
        description: tq('lineItems.description'),
        quantity: tq('lineItems.quantity'),
        unitPrice: tq('lineItems.unitPrice'),
        discount: tq('lineItems.discount'),
        taxRate: tq('lineItems.taxRate'),
        lineTotal: tq('lineItems.lineTotal'),
        subtotal: tq('lineItems.subtotal'),
        discountTotal: tq('lineItems.discountTotal'),
        taxTotal: tq('lineItems.taxTotal'),
        total: tq('lineItems.total'),
        amountPaid: t('fields.amountPaid'),
        balanceDue: t('fields.balanceDue'),
        statusLabel: t('fields.status'),
        notes: t('fields.notes'),
        terms: t('fields.terms'),
        pageOf: (current: number, total: number) => `${current} / ${total}`,
      },
    }),
  );

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${inv.invoice_number}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
