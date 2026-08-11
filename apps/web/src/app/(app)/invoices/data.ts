import { requireBusiness } from '@/lib/auth/session';
import { listCustomers } from '@/lib/api/customers';
import { listProducts } from '@/lib/api/products';
import { getSettings } from '@/lib/api/settings';
import type { CustomerOption } from '@/app/(app)/quotations/quotation-form';
import type { ProductOption } from '@/components/forms/line-items-table';

export async function loadPickerData(): Promise<{
  customers: CustomerOption[];
  products: ProductOption[];
  defaultCurrency: string;
  defaultTaxRate: number;
  defaultPaymentTermsDays: number;
  fiscalEnabled: boolean;
}> {
  await requireBusiness();

  const [customersRes, productsRes, settingsRes] = await Promise.all([
    listCustomers({ size: 1000 }),
    listProducts({ size: 1000 }),
    getSettings(),
  ]);

  if (!customersRes.ok) throw new Error(customersRes.error);
  if (!productsRes.ok) throw new Error(productsRes.error);
  if (!settingsRes.ok) throw new Error(settingsRes.error);

  return {
    customers: customersRes.data.rows.map((c) => ({
      id: c.id,
      name: c.name,
      company_name: c.company_name,
    })) as CustomerOption[],
    products: productsRes.data.rows.map((p) => ({
      id: p.id,
      name: p.name,
      unit_price: Number(p.unit_price),
      is_taxable: p.is_taxable,
      tax_rate_override: null,
    })) as ProductOption[],
    defaultCurrency: settingsRes.data.default_currency,
    defaultTaxRate: Number(settingsRes.data.default_tax_rate),
    defaultPaymentTermsDays: Number(settingsRes.data.default_payment_terms_days),
    fiscalEnabled: settingsRes.data.fiscal_enabled,
  };
}
