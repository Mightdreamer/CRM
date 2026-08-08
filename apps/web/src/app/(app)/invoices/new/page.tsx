import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { InvoiceForm } from '../invoice-form';
import { createInvoice } from '../actions';
import { loadPickerData } from '../data';
import {
  QuotationSelector,
  type QuotationOption,
} from '../quotation-selector';
import { getQuotation, listQuotations } from '@/lib/api/quotations';
import type { LineItemRow } from '@/components/forms/line-items-table';

export default async function NewInvoicePage(props: PageProps<'/invoices/new'>) {
  const searchParams = await props.searchParams;
  const quotationId =
    typeof searchParams.quotation_id === 'string'
      ? searchParams.quotation_id
      : undefined;

  const t = await getTranslations('invoices');
  const tc = await getTranslations('common');
  const locale = await getLocale();
  const { customers, products, defaultCurrency, defaultTaxRate, defaultPaymentTermsDays } =
    await loadPickerData();

  const [pendingRes, selectedRes] = await Promise.all([
    listQuotations({ size: 100, availableForInvoice: true }),
    quotationId ? getQuotation(quotationId) : Promise.resolve(null),
  ]);
  if (!pendingRes.ok) throw new Error(pendingRes.error);
  if (selectedRes && !selectedRes.ok) throw new Error(selectedRes.error);

  const quotationOptions: QuotationOption[] = pendingRes.data.rows.map((r) => ({
    id: r.id,
    quotation_number: r.quotation_number,
    status: r.status,
    total: Number(r.total),
    currency: r.currency,
    customer_name: r.customer?.company_name
      ? `${r.customer.name} — ${r.customer.company_name}`
      : (r.customer?.name ?? '—'),
  }));

  const formDefaults = selectedRes?.ok
    ? {
        customer_id: selectedRes.data.quotation.customer_id,
        notes: selectedRes.data.quotation.notes ?? undefined,
        terms: selectedRes.data.quotation.terms ?? undefined,
        items: selectedRes.data.items.map<LineItemRow>((it) => ({
          product_id: it.product_id ?? undefined,
          description: it.description ?? undefined,
          quantity: it.quantity,
          unit_price: it.unit_price,
          discount_pct: it.discount_pct,
          tax_rate: it.tax_rate,
        })),
      }
    : undefined;

  const formCurrency = selectedRes?.ok
    ? selectedRes.data.quotation.currency
    : defaultCurrency;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" render={<Link href="/invoices" />}>
        <ChevronLeft className="h-4 w-4" />
        {tc('back')}
      </Button>
      <h1 className="text-2xl font-semibold">{t('newInvoice')}</h1>
      <QuotationSelector
        quotations={quotationOptions}
        selectedId={quotationId}
        locale={locale}
      />
      <InvoiceForm
        key={quotationId ?? 'blank'}
        customers={customers}
        products={products}
        defaultTaxRate={defaultTaxRate}
        defaultPaymentTermsDays={defaultPaymentTermsDays}
        currency={formCurrency}
        locale={locale}
        defaults={formDefaults}
        quotationId={quotationId}
        action={createInvoice}
      />
    </div>
  );
}
