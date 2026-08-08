import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { requireBusiness } from '@/lib/auth/session';
import { getInvoice } from '@/lib/api/invoices';
import { InvoiceForm } from '../../invoice-form';
import { updateInvoice } from '../../actions';
import { loadPickerData } from '../../data';

export default async function EditInvoicePage(props: PageProps<'/invoices/[id]/edit'>) {
  const { id } = await props.params;
  await requireBusiness();
  const t = await getTranslations('invoices');
  const tc = await getTranslations('common');
  const locale = await getLocale();

  const res = await getInvoice(id);
  if (!res.ok) {
    if (res.error.includes('not found')) notFound();
    throw new Error(res.error);
  }
  const { invoice: inv, items } = res.data;
  if (inv.deleted_at) notFound();
  if (inv.status !== 'draft') {
    redirect(`/invoices/${id}`);
  }

  const itemRows = items.map((it) => ({
    product_id: it.product_id ?? undefined,
    description: it.description ?? undefined,
    quantity: Number(it.quantity),
    unit_price: Number(it.unit_price),
    discount_pct: Number(it.discount_pct),
    tax_rate: Number(it.tax_rate),
  }));

  const { customers, products, defaultTaxRate, defaultPaymentTermsDays } = await loadPickerData();
  const boundAction = updateInvoice.bind(null, id);

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" render={<Link href={`/invoices/${id}`} />}>
        <ChevronLeft className="h-4 w-4" />
        {tc('back')}
      </Button>
      <h1 className="text-2xl font-semibold">
        {t('editInvoice')} <span className="text-muted-foreground">· {inv.invoice_number}</span>
      </h1>
      <InvoiceForm
        customers={customers}
        products={products}
        defaultTaxRate={defaultTaxRate}
        defaultPaymentTermsDays={defaultPaymentTermsDays}
        currency={inv.currency}
        locale={locale}
        defaults={{
          customer_id: inv.customer_id,
          issue_date: inv.issue_date,
          due_date: inv.due_date ?? undefined,
          notes: inv.notes ?? undefined,
          terms: inv.terms ?? undefined,
          items: itemRows,
        }}
        action={boundAction}
      />
    </div>
  );
}
