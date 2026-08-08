import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft, Download, Pencil } from 'lucide-react';
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
import { getQuotation } from '@/lib/api/quotations';
import { formatMoney } from '@crm/core/money';
import type { QuotationStatus } from '@crm/contracts/quotation';
import { StatusActions } from './status-actions';

const statusVariant: Record<QuotationStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'secondary',
  sent: 'outline',
  accepted: 'default',
  rejected: 'destructive',
  expired: 'secondary',
};

export default async function QuotationDetailPage(props: PageProps<'/quotations/[id]'>) {
  const { id } = await props.params;
  await requireBusiness();
  const t = await getTranslations('quotations');
  const tc = await getTranslations('common');
  const locale = await getLocale();

  const res = await getQuotation(id);
  if (!res.ok) {
    if (res.error.includes('not found')) notFound();
    throw new Error(res.error);
  }
  const { quotation: q, customer, items } = res.data;

  const fmt = (n: number) => formatMoney(Number(n), { currency: q.currency, locale });
  const canEdit = !q.converted_invoice_id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" render={<Link href="/quotations" />}>
          <ChevronLeft className="h-4 w-4" />
          {tc('back')}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            render={<a href={`/api/pdf/quotation/${id}`} target="_blank" rel="noopener" />}
          >
            <Download className="h-4 w-4" />
            {t('downloadPdf')}
          </Button>
          {canEdit && (
            <Button variant="outline" size="sm" render={<Link href={`/quotations/${id}/edit`} />}>
              <Pencil className="h-4 w-4" />
              {tc('edit')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{q.quotation_number}</h1>
        <Badge variant={statusVariant[q.status]}>{t(`status.${q.status}`)}</Badge>
        {q.converted_invoice_id && (
          <span className="text-sm text-muted-foreground">
            {t.rich('alreadyConverted', { number: () => '↗' })}
          </span>
        )}
      </div>

      <StatusActions id={q.id} status={q.status} />

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
              <span>{q.issue_date}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('fields.expiryDate')}</span>
              <span>{q.expiry_date ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('fields.currency')}</span>
              <span>{q.currency}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('lineItems.description')}</TableHead>
              <TableHead className="text-right">{t('lineItems.quantity')}</TableHead>
              <TableHead className="text-right">{t('lineItems.unitPrice')}</TableHead>
              <TableHead className="text-right">{t('lineItems.discount')}</TableHead>
              <TableHead className="text-right">{t('lineItems.taxRate')}</TableHead>
              <TableHead className="text-right">{t('lineItems.lineTotal')}</TableHead>
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
            <dt className="text-muted-foreground">{t('lineItems.subtotal')}</dt>
            <dd className="tabular-nums">{fmt(Number(q.subtotal))}</dd>
          </div>
          {Number(q.discount_total) > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('lineItems.discountTotal')}</dt>
              <dd className="tabular-nums">-{fmt(Number(q.discount_total))}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('lineItems.taxTotal')}</dt>
            <dd className="tabular-nums">{fmt(Number(q.tax_total))}</dd>
          </div>
          <div className="flex justify-between border-t pt-1 font-semibold">
            <dt>{t('lineItems.total')}</dt>
            <dd className="tabular-nums">{fmt(Number(q.total))}</dd>
          </div>
        </dl>
      </div>

      {(q.notes || q.terms) && (
        <div className="grid gap-4 md:grid-cols-2">
          {q.notes && (
            <Card>
              <CardContent className="py-4 text-sm whitespace-pre-wrap">
                <p className="text-muted-foreground mb-1">{t('fields.notes')}</p>
                {q.notes}
              </CardContent>
            </Card>
          )}
          {q.terms && (
            <Card>
              <CardContent className="py-4 text-sm whitespace-pre-wrap">
                <p className="text-muted-foreground mb-1">{t('fields.terms')}</p>
                {q.terms}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
