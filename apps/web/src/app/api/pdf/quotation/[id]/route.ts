import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { getTranslations } from 'next-intl/server';
import { requireBusiness } from '@/lib/auth/session';
import { getQuotation } from '@/lib/api/quotations';
import { getSettings } from '@/lib/api/settings';
import { QuotationPDF } from '@/lib/pdf/QuotationPDF';

export const runtime = 'nodejs';

export async function GET(_req: Request, ctxParams: RouteContext<'/api/pdf/quotation/[id]'>) {
  const { id } = await ctxParams.params;
  await requireBusiness();
  const t = await getTranslations('quotations');

  const [quotationRes, settingsRes] = await Promise.all([
    getQuotation(id),
    getSettings(),
  ]);
  if (!quotationRes.ok) {
    return new NextResponse(quotationRes.error, {
      status: quotationRes.error.includes('not found') ? 404 : 500,
    });
  }
  if (!settingsRes.ok) {
    return new NextResponse(settingsRes.error, { status: 500 });
  }
  const { quotation: q, customer, items } = quotationRes.data;
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
    QuotationPDF({
      business: business as Parameters<typeof QuotationPDF>[0]['business'],
      customer,
      quotation: {
        quotation_number: q.quotation_number,
        issue_date: q.issue_date,
        expiry_date: q.expiry_date,
        notes: q.notes,
        terms: q.terms,
        subtotal: Number(q.subtotal),
        discount_total: Number(q.discount_total),
        tax_total: Number(q.tax_total),
        total: Number(q.total),
        currency: q.currency,
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
        expiryDate: t('fields.expiryDate'),
        billTo: t('fields.customer'),
        description: t('lineItems.description'),
        quantity: t('lineItems.quantity'),
        unitPrice: t('lineItems.unitPrice'),
        discount: t('lineItems.discount'),
        taxRate: t('lineItems.taxRate'),
        lineTotal: t('lineItems.lineTotal'),
        subtotal: t('lineItems.subtotal'),
        discountTotal: t('lineItems.discountTotal'),
        taxTotal: t('lineItems.taxTotal'),
        total: t('lineItems.total'),
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
      'Content-Disposition': `inline; filename="${q.quotation_number}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
