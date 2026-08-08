'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ProductCombobox, type ProductOption } from '@/components/forms/product-combobox';
import { calculateTotals } from '@crm/core/money';
import { formatMoney } from '@crm/core/money';

export type { ProductOption } from '@/components/forms/product-combobox';

export type LineItemRow = {
  product_id?: string;
  description?: string;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_rate: number;
};

type Props = {
  /** Hidden input name. The server action reads JSON from this field. */
  name?: string;
  initial?: LineItemRow[];
  products: ProductOption[];
  /** Business default tax rate, used when a product is taxable but has no override. */
  defaultTaxRate: number;
  currency: string;
  locale: string;
  onProductCreated?: (product: ProductOption) => void;
};

function emptyRow(): LineItemRow {
  return {
    quantity: 1,
    unit_price: 0,
    discount_pct: 0,
    tax_rate: 0,
  };
}

export function LineItemsTable({
  name = 'items',
  initial,
  products,
  defaultTaxRate,
  currency,
  locale,
  onProductCreated,
}: Props) {
  const t = useTranslations('quotations.lineItems');
  const [rows, setRows] = useState<LineItemRow[]>(
    initial && initial.length > 0 ? initial : [emptyRow()],
  );

  const totals = useMemo(
    () =>
      calculateTotals(
        rows.map((r) => ({
          quantity: Number(r.quantity) || 0,
          unitPrice: Number(r.unit_price) || 0,
          discountPct: Number(r.discount_pct) || 0,
          taxRate: Number(r.tax_rate) || 0,
        })),
      ),
    [rows],
  );

  function update(i: number, patch: Partial<LineItemRow>) {
    setRows((prev) => prev.map((r, j) => (i === j ? { ...r, ...patch } : r)));
  }
  function remove(i: number) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));
  }
  function applyProduct(i: number, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) return;
    const taxRate = p.is_taxable ? (p.tax_rate_override ?? defaultTaxRate) : 0;
    update(i, {
      product_id: p.id,
      unit_price: Number(p.unit_price),
      tax_rate: taxRate,
    });
  }

  const fmt = (n: number) => formatMoney(n, { currency, locale });

  return (
    <div className="space-y-4">
      <input type="hidden" name={name} value={JSON.stringify(rows)} readOnly />

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/40 text-xs uppercase text-muted-foreground">
              <th className="px-3 py-2 text-left w-56">{t('product')}</th>
              <th className="px-3 py-2 text-left">{t('description')}</th>
              <th className="px-3 py-2 text-right w-20">{t('quantity')}</th>
              <th className="px-3 py-2 text-right w-28">{t('unitPrice')}</th>
              <th className="px-3 py-2 text-right w-20">{t('discount')}</th>
              <th className="px-3 py-2 text-right w-20">{t('taxRate')}</th>
              <th className="px-3 py-2 text-right w-28">{t('lineTotal')}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const line = totals.lines[i];
              return (
                <tr key={i} className="border-b last:border-b-0 align-top">
                  <td className="px-3 py-2">
                    <ProductCombobox
                      products={products}
                      value={row.product_id}
                      onChange={(productId) => applyProduct(i, productId)}
                      onCreated={onProductCreated}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={row.description ?? ''}
                      onChange={(e) => update(i, { description: e.target.value })}
                      placeholder={t('descriptionPlaceholder')}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      className="text-right"
                      value={row.quantity}
                      onChange={(e) =>
                        update(i, { quantity: Number.parseFloat(e.target.value) || 0 })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      className="text-right"
                      value={row.unit_price}
                      onChange={(e) =>
                        update(i, { unit_price: Number.parseFloat(e.target.value) || 0 })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      max="1"
                      className="text-right"
                      value={row.discount_pct}
                      onChange={(e) =>
                        update(i, { discount_pct: Number.parseFloat(e.target.value) || 0 })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.0001"
                      min="0"
                      max="1"
                      className="text-right"
                      value={row.tax_rate}
                      onChange={(e) =>
                        update(i, { tax_rate: Number.parseFloat(e.target.value) || 0 })
                      }
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">
                    {fmt(line?.lineTotal ?? 0)}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(i)}
                      disabled={rows.length <= 1}
                      aria-label={t('remove')}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setRows((r) => [...r, emptyRow()])}
        >
          <Plus className="h-4 w-4" />
          {t('addRow')}
        </Button>

        <dl className="min-w-[16rem] space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('subtotal')}</dt>
            <dd className="tabular-nums">{fmt(totals.subtotal)}</dd>
          </div>
          {totals.discountTotal > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">{t('discountTotal')}</dt>
              <dd className="tabular-nums">-{fmt(totals.discountTotal)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted-foreground">{t('taxTotal')}</dt>
            <dd className="tabular-nums">{fmt(totals.taxTotal)}</dd>
          </div>
          <div className="flex justify-between border-t pt-1 font-semibold">
            <dt>{t('total')}</dt>
            <dd className="tabular-nums">{fmt(totals.total)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
