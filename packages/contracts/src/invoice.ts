import { z } from 'zod';
import { lineItemSchema, type LineItemInput } from './quotation';

export const invoiceStatuses = [
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled',
] as const;
export type InvoiceStatus = (typeof invoiceStatuses)[number];

const dateString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const invoiceHeaderSchema = z.object({
  customer_id: z.string().uuid('Pick a customer'),
  issue_date: dateString,
  due_date: dateString.optional().or(z.literal('').transform(() => undefined)),
  notes: z.string().trim().max(5000).optional().or(z.literal('').transform(() => undefined)),
  terms: z.string().trim().max(5000).optional().or(z.literal('').transform(() => undefined)),
  currency: z.string().trim().length(3).default('DOP'),
  quotation_id: z
    .string()
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export const invoiceSchema = invoiceHeaderSchema.extend({
  items: z.array(lineItemSchema).min(1, 'Add at least one item'),
});

export type InvoiceInput = z.infer<typeof invoiceSchema>;
export type InvoiceLineInput = LineItemInput;

export type Invoice = {
  id: string;
  business_id: string;
  customer_id: string;
  quotation_id: string | null;
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  status: InvoiceStatus;
  notes: string | null;
  terms: string | null;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  currency: string;
  fiscal_metadata: Record<string, unknown>;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoiceItem = {
  id: string;
  invoice_id: string;
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
