import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Download, FileText, Pencil } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { requireBusiness } from '@/lib/auth/session';
import { getInvoice } from '@/lib/api/invoices';
import { formatMoney } from '@crm/core/money';
import type { InvoiceStatus } from '@crm/contracts/invoice';
import { InvoiceActions } from './invoice-actions';
import { PaymentsPanel } from './payments-panel';

const statusVariant: Record<InvoiceStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'secondary',
  issued: 'outline',
  partially_paid: 'outline',
  paid: 'default',
  overdue: 'destructive',
  cancelled: 'secondary',
};

export default async function InvoiceDetailPage(props: PageProps<'/invoices/[id]'>) {
  const { id } = await props.params;
  await requireBusiness();
  const t = await getTranslations('invoices');
  const tc = await getTranslations('common');
  const tq = await getTranslations('quotations');
  const locale = await getLocale();

  const res = await getInvoice(id);
  if (!res.ok) {
    if (res.error.includes('not found')) notFound();
    throw new Error(res.error);
  }
  const { invoice: inv, customer, items, payments, quotation_number } = res.data;

  const fmt = (n: number) => formatMoney(Number(n), { currency: inv.currency, locale });
  const canEditInvoice = inv.status === 'draft';
  const canAddPayments = inv.status !== 'draft' && inv.status !== 'cancelled';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" render={<Link href="/invoices" />}>
          <ChevronLeft className="h-4 w-4" />
          {tc('back')}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            render={<a href={`/api/pdf/invoice/${id}`} target="_blank" rel="noopener" />}
          >
            <Download className="h-4 w-4" />
            {t('downloadPdf')}
          </Button>
          {canEditInvoice && (
            <Button variant="outline" size="sm" render={<Link href={`/invoices/${id}/edit`} />}>
              <Pencil className="h-4 w-4" />
              {tc('edit')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{inv.invoice_number}</h1>
        <Badge variant={statusVariant[inv.status]}>{t(`status.${inv.status}`)}</Badge>
        {quotation_number && (
          <Link
            href={`/quotations/${inv.quotation_id}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <FileText className="h-3.5 w-3.5" />
            {t.rich('sourceQuotation', { number: () => quotation_number })}
          </Link>
        )}
      </div>

      <InvoiceActions id={inv.id} status={inv.status} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="space-y-1 py-4 text-sm">
            <p className="text-muted-foreground">{t('fields.customer')}</p>
            <p className="font-medium">
              {customer.company_name || customer.name || '—'}
            </p>
            {customer.tax_id && (
              <p className="text-xs text-muted-foreground">RNC/Cédula: {customer.tax_id}</p>
            )}
            {customer.email && (
              <p className="text-xs text-muted-foreground">{customer.email}</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-sm space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('fields.issueDate')}</span>
              <span>{inv.issue_date}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('fields.dueDate')}</span>
              <span>{inv.due_date ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('fields.currency')}</span>
              <span>{inv.currency}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{tq('lineItems.description')}</TableHead>
              <TableHead className="text-right">{tq('lineItems.quantity')}</TableHead>
              <TableHead className="text-right">{tq('lineItems.unitPrice')}</TableHead>
              <TableHead className="text-right">{tq('lineItems.discount')}</TableHead>
              <TableHead className="text-right">{tq('lineItems.taxRate')}</TableHead>
              <TableHead className="text-right">{tq('lineItems.lineTotal')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((it) => (
              <TableRow key={it.id}>
                <TableCell>
                  <div className="font-medium">{it.product_name}</div>
                  {it.description && (
                    <div className="text-xs text-muted-foreground">{it.description}</div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{Number(it.quantity)}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(Number(it.unit_price))}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {(Number(it.discount_pct) * 100).toFixed(2)}%
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {(Number(it.tax_rate) * 100).toFixed(2)}%
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {fmt(Number(it.line_total))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex justify-end">
        <dl className="min-w-[18rem] text-sm space-y-1">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{tq('lineItems.subtotal')}</dt>
            <dd className="tabular-nums">{fmt(Number(inv.subtotal))}</dd>
          </div>
          {Number(inv.discount_total) > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{tq('lineItems.discountTotal')}</dt>
              <dd className="tabular-nums">-{fmt(Number(inv.discount_total))}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{tq('lineItems.taxTotal')}</dt>
            <dd className="tabular-nums">{fmt(Number(inv.tax_total))}</dd>
          </div>
          <div className="flex justify-between border-t pt-1 font-semibold">
            <dt>{tq('lineItems.total')}</dt>
            <dd className="tabular-nums">{fmt(Number(inv.total))}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('fields.amountPaid')}</dt>
            <dd className="tabular-nums">{fmt(Number(inv.amount_paid))}</dd>
          </div>
          <div className="flex justify-between font-semibold">
            <dt>{t('fields.balanceDue')}</dt>
            <dd className="tabular-nums">{fmt(Number(inv.balance_due))}</dd>
          </div>
        </dl>
      </div>

      <PaymentsPanel
        invoiceId={inv.id}
        currency={inv.currency}
        locale={locale}
        canEdit={canAddPayments}
        payments={payments.map((p) => ({
          id: p.id,
          payment_date: p.payment_date,
          amount: Number(p.amount),
          method: p.method,
          reference: p.reference,
          notes: p.notes,
        }))}
      />

      {(inv.notes || inv.terms) && (
        <div className="grid gap-4 md:grid-cols-2">
          {inv.notes && (
            <Card>
              <CardContent className="py-4 text-sm whitespace-pre-wrap">
                <p className="text-muted-foreground mb-1">{t('fields.notes')}</p>
                {inv.notes}
              </CardContent>
            </Card>
          )}
          {inv.terms && (
            <Card>
              <CardContent className="py-4 text-sm whitespace-pre-wrap">
                <p className="text-muted-foreground mb-1">{t('fields.terms')}</p>
                {inv.terms}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
