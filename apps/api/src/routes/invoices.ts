import { Hono } from 'hono';
import { invoiceSchema, invoiceStatuses } from '@crm/contracts/invoice';
import { paymentSchema } from '@crm/contracts/payment';
import type { FiscalEmissionResult } from '@crm/contracts/fiscal';
import {
  addPayment,
  changeInvoiceStatus,
  createInvoice,
  getInvoiceDetail,
  listInvoices,
  removePayment,
  softDeleteInvoice,
  updateInvoice,
} from '../domain/invoices';
import { notFoundError, validationError } from '../lib/errors';
import {
  emitInvoiceAutomatically,
  emitInvoiceToFiscal,
  retryInvoiceFiscalEmission,
} from '../lib/fiscal-platform/emission';
import { created, noContent, ok } from '../lib/responses';
import { type AuthEnv, getCtx } from '../middleware/auth';

const route = new Hono<AuthEnv>();

route.get('/', async (c) => {
  const ctx = getCtx(c);
  const url = new URL(c.req.url);
  const q = url.searchParams.get('q') ?? undefined;
  const statusParam = url.searchParams.get('status');
  const status =
    statusParam && (invoiceStatuses as readonly string[]).includes(statusParam)
      ? (statusParam as (typeof invoiceStatuses)[number])
      : undefined;
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
  const size = Math.min(100, Math.max(1, Number(url.searchParams.get('size') ?? '25')));

  const result = await listInvoices(ctx, { q, status, page, size });
  return ok(c, { ...result, page, size });
});

route.get('/:id', async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');
  const detail = await getInvoiceDetail(ctx, id);
  if (!detail) throw notFoundError('Invoice not found');
  return ok(c, detail);
});

route.post('/', async (c) => {
  const ctx = getCtx(c);
  const body = await c.req.json().catch(() => ({}));
  const parsed = invoiceSchema.safeParse(body);
  if (!parsed.success) {
    throw validationError('Validation failed', parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }
  const result = await createInvoice(ctx, parsed.data);
  return created(c, result);
});

route.put('/:id', async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const parsed = invoiceSchema.safeParse(body);
  if (!parsed.success) {
    throw validationError('Validation failed', parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }
  const result = await updateInvoice(ctx, id, parsed.data);
  return ok(c, result);
});

route.patch('/:id/status', async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const target = String(body?.status ?? '');
  if (!['draft', 'issued', 'cancelled'].includes(target)) {
    throw validationError('Invalid status target');
  }
  const status = await changeInvoiceStatus(
    ctx,
    id,
    target as 'draft' | 'issued' | 'cancelled',
  );
  const fiscal: FiscalEmissionResult =
    target === 'issued'
      ? await emitInvoiceAutomatically(ctx, id)
      : { attempted: false, outcome: 'not_applicable', metadata: {} };
  return ok(c, { status, fiscal });
});

route.post('/:id/emit-ecf', async (c) => {
  const result = await emitInvoiceToFiscal(getCtx(c), c.req.param('id'));
  return ok(c, result.metadata);
});

route.post('/:id/retry-ecf', async (c) => {
  const result = await retryInvoiceFiscalEmission(
    getCtx(c),
    c.req.param('id'),
  );
  return ok(c, result.metadata);
});

route.delete('/:id', async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');
  await softDeleteInvoice(ctx, id);
  return noContent(c);
});

route.post('/:id/payments', async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  // Force invoice_id from URL
  const parsed = paymentSchema.safeParse({ ...body, invoice_id: id });
  if (!parsed.success) {
    throw validationError('Validation failed', parsed.error.flatten().fieldErrors as Record<string, string[]>);
  }
  await addPayment(ctx, parsed.data);
  return noContent(c);
});

route.delete('/:id/payments/:pid', async (c) => {
  const ctx = getCtx(c);
  const id = c.req.param('id');
  const pid = c.req.param('pid');
  await removePayment(ctx, id, pid);
  return noContent(c);
});

export { route as invoicesRoute };
