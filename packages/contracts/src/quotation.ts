import { z } from 'zod';

export const quotationStatuses = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
] as const;
export type QuotationStatus = (typeof quotationStatuses)[number];

export const lineItemSchema = z.object({
  product_id: z.string().uuid('Pick a product'),
  description: z
    .string()
    .trim()
    .max(500)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  quantity: z.coerce.number().positive('Must be > 0').max(999_999),
  unit_price: z.coerce.number().min(0).max(99_999_999),
  discount_pct: z.coerce.number().min(0).max(1).default(0),
  tax_rate: z.coerce.number().min(0).max(1).default(0),
});
export type LineItemInput = z.infer<typeof lineItemSchema>;

const dateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const quotationHeaderSchema = z.object({
  customer_id: z.string().uuid('Pick a customer'),
  issue_date: dateString,
  expiry_date: dateString.optional().or(z.literal('').transform(() => undefined)),
  notes: z.string().trim().max(5000).optional().or(z.literal('').transform(() => undefined)),
  terms: z.string().trim().max(5000).optional().or(z.literal('').transform(() => undefined)),
  currency: z.string().trim().length(3).default('DOP'),
});

export const quotationSchema = quotationHeaderSchema.extend({
  items: z.array(lineItemSchema).min(1, 'Add at least one item'),
});

export type QuotationInput = z.infer<typeof quotationSchema>;

export type Quotation = {
  id: string;
  business_id: string;
  customer_id: string;
  quotation_number: string;
  issue_date: string;
  expiry_date: string | null;
  status: QuotationStatus;
  notes: string | null;
  terms: string | null;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  currency: string;
  converted_invoice_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type QuotationItem = {
  id: string;
  quotation_id: string;
  product_id: string | null;
  product_name: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_rate: number;
  line_subtotal: number;
  line_tax: number;
  line_total: number;
  sort_order: number;
};
