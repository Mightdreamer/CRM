'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  LineItemsTable,
  type LineItemRow,
  type ProductOption,
} from '@/components/forms/line-items-table';
import type { CustomerOption } from '@/app/(app)/quotations/quotation-form';
import type { InvoiceActionResult } from './actions';

type Props = {
  customers: CustomerOption[];
  products: ProductOption[];
  defaultTaxRate: number;
  defaultPaymentTermsDays: number;
  currency: string;
  locale: string;
  fiscalEnabled: boolean;
  defaults?: {
    customer_id?: string;
    issue_date?: string;
    due_date?: string;
    notes?: string;
    terms?: string;
    fiscal_opt_out?: boolean;
    items?: LineItemRow[];
  };
  quotationId?: string;
  action: (
    prev: InvoiceActionResult | null,
    formData: FormData,
  ) => Promise<InvoiceActionResult>;
};

export function InvoiceForm({
  customers,
  products,
  defaultTaxRate,
  defaultPaymentTermsDays,
  currency,
  locale,
  fiscalEnabled,
  defaults,
  quotationId,
  action,
}: Props) {
  const t = useTranslations('invoices');
  const tc = useTranslations('common');
  const [state, formAction, pending] = useActionState<InvoiceActionResult | null, FormData>(
    action,
    null,
  );

  const err = (key: string) =>
    state && !state.ok && state.fieldErrors?.[key]?.[0] ? state.fieldErrors[key][0] : null;

  const today = new Date().toISOString().slice(0, 10);
  const defaultDue = (() => {
    const d = new Date();
    d.setDate(d.getDate() + defaultPaymentTermsDays);
    return d.toISOString().slice(0, 10);
  })();

  return (
    <form action={formAction} className="space-y-6">
      {quotationId && (
        <input type="hidden" name="quotation_id" value={quotationId} />
      )}
      <div className="grid gap-4 sm:grid-cols-2 max-w-4xl">
        <div className="space-y-1.5">
          <Label htmlFor="customer_id">{t('fields.customer')} *</Label>
          <Select name="customer_id" defaultValue={defaults?.customer_id} required>
            <SelectTrigger id="customer_id" className="w-full">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.company_name ? `${c.name} — ${c.company_name}` : c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {err('customer_id') && <p className="text-xs text-red-600">{err('customer_id')}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="currency">{t('fields.currency')}</Label>
          <Input
            id="currency"
            name="currency"
            defaultValue={currency}
            maxLength={3}
            className="uppercase"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="issue_date">{t('fields.issueDate')} *</Label>
          <Input
            id="issue_date"
            name="issue_date"
            type="date"
            required
            defaultValue={defaults?.issue_date ?? today}
          />
          {err('issue_date') && <p className="text-xs text-red-600">{err('issue_date')}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="due_date">{t('fields.dueDate')}</Label>
          <Input
            id="due_date"
            name="due_date"
            type="date"
            defaultValue={defaults?.due_date ?? defaultDue}
          />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="notes">{t('fields.notes')}</Label>
          <Textarea id="notes" name="notes" rows={2} defaultValue={defaults?.notes ?? ''} />
        </div>

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="terms">{t('fields.terms')}</Label>
          <Textarea id="terms" name="terms" rows={2} defaultValue={defaults?.terms ?? ''} />
        </div>
      </div>

      <div>
        <LineItemsTable
          products={products}
          defaultTaxRate={defaultTaxRate}
          currency={currency}
          locale={locale}
          initial={defaults?.items}
        />
        {err('items') && <p className="text-xs text-red-600 mt-1">{err('items')}</p>}
      </div>

      {fiscalEnabled && (
        <div className="flex items-start gap-3 rounded-md border p-4 max-w-4xl">
          <Checkbox
            id="fiscal_opt_out"
            name="fiscal_opt_out"
            defaultChecked={defaults?.fiscal_opt_out ?? false}
          />
          <div className="space-y-1">
            <Label htmlFor="fiscal_opt_out">{t('fields.fiscalOptOut')}</Label>
            <p className="text-sm text-muted-foreground">
              {t('fields.fiscalOptOutHelp')}
            </p>
          </div>
        </div>
      )}

      {state && !state.ok && !state.fieldErrors && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? '…' : tc('save')}
      </Button>
    </form>
  );
}
