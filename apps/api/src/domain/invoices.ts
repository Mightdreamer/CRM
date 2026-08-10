import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import {
  businesses,
  customers,
  invoiceItems,
  invoices,
  payments,
  quotations,
} from '@crm/db/schema';
import type { InvoiceInput, InvoiceStatus } from '@crm/contracts/invoice';
import type { PaymentInput } from '@crm/contracts/payment';
import { applyPayments, calculateTotals } from '@crm/core/money';
import { getDb } from '../lib/db';
import type { FiscalInvoiceInputs } from '../lib/fiscal-platform/mapper';
import {
  conflictError,
  notFoundError,
  validationError,
} from '../lib/errors';
import type { Ctx } from '../middleware/auth';
import { getProductNamesByIds } from './products';

const QUOTATION_STATUSES_NOT_INVOICEABLE = new Set(['rejected', 'expired']);

function computeDocTotals(items: InvoiceInput['items']) {
  return calculateTotals(
    items.map((i) => ({
      quantity: i.quantity,
      unitPrice: i.unit_price,
      discountPct: i.discount_pct ?? 0,
      taxRate: i.tax_rate ?? 0,
    })),
  );
}

async function nextInvoiceNumber(businessId: string): Promise<string> {
  const db = getDb();
  const result = await db.execute<{ next_invoice_number: string }>(
    sql`select public.next_invoice_number(${businessId}::uuid) as next_invoice_number`,
  );
  const value = result.rows[0]?.next_invoice_number;
  if (!value) throw new Error('Failed to allocate invoice number');
  return value;
}

export async function createInvoice(
  ctx: Ctx,
  input: InvoiceInput,
): Promise<{ id: string; invoice_number: string }> {
  const db = getDb();
  const totals = computeDocTotals(input.items);
  const productNames = await getProductNamesByIds(
    ctx,
    input.items.map((i) => i.product_id),
  );
  const invoiceNumber = await nextInvoiceNumber(ctx.businessId);

  if (input.quotation_id) {
    const rows = await db
      .select({
        status: quotations.status,
        convertedInvoiceId: quotations.convertedInvoiceId,
      })
      .from(quotations)
      .where(
        and(
          eq(quotations.id, input.quotation_id),
          eq(quotations.businessId, ctx.businessId),
          isNull(quotations.deletedAt),
        ),
      )
      .limit(1);
    const q = rows[0];
    if (!q) throw notFoundError('Quotation not found');
    if (q.convertedInvoiceId) {
      throw conflictError('This quotation has already been converted.');
    }
    if (QUOTATION_STATUSES_NOT_INVOICEABLE.has(q.status)) {
      throw validationError(
        'Rejected or expired quotations cannot be invoiced.',
      );
    }
  }

  return await db.transaction(async (tx) => {
    const [header] = await tx
      .insert(invoices)
      .values({
        businessId: ctx.businessId,
        customerId: input.customer_id,
        quotationId: input.quotation_id ?? null,
        invoiceNumber,
        issueDate: input.issue_date,
        dueDate: input.due_date ?? null,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        currency: input.currency,
        status: 'draft',
        subtotal: String(totals.subtotal),
        discountTotal: String(totals.discountTotal),
        taxTotal: String(totals.taxTotal),
        total: String(totals.total),
        amountPaid: '0',
        balanceDue: String(totals.total),
        createdBy: ctx.userId,
      })
      .returning({ id: invoices.id });
    if (!header) throw new Error('Invoice insert returned no row');

    await tx.insert(invoiceItems).values(
      input.items.map((it, idx) => ({
        invoiceId: header.id,
        productId: it.product_id,
        productName: productNames.get(it.product_id)!,
        description: it.description ?? null,
        quantity: String(it.quantity),
        unitPrice: String(it.unit_price),
        discountPct: String(it.discount_pct ?? 0),
        taxRate: String(it.tax_rate ?? 0),
        lineSubtotal: String(totals.lines[idx]!.lineSubtotal),
        lineTax: String(totals.lines[idx]!.lineTax),
        lineTotal: String(totals.lines[idx]!.lineTotal),
        sortOrder: idx,
      })),
    );

    if (input.quotation_id) {
      await tx
        .update(quotations)
        .set({ convertedInvoiceId: header.id })
        .where(
          and(
            eq(quotations.id, input.quotation_id),
            eq(quotations.businessId, ctx.businessId),
            isNull(quotations.convertedInvoiceId),
          ),
        );
    }

    return { id: header.id, invoice_number: invoiceNumber };
  });
}

export async function updateInvoice(
  ctx: Ctx,
  id: string,
  input: InvoiceInput,
): Promise<{ id: string }> {
  const db = getDb();
  const totals = computeDocTotals(input.items);
  const productNames = await getProductNamesByIds(
    ctx,
    input.items.map((i) => i.product_id),
  );

  const existing = await db
    .select({ status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.businessId, ctx.businessId)))
    .limit(1);
  const row = existing[0];
  if (!row) throw notFoundError('Invoice not found');
  if (row.status !== 'draft') {
    throw conflictError('Only draft invoices can be edited');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(invoices)
      .set({
        customerId: input.customer_id,
        issueDate: input.issue_date,
        dueDate: input.due_date ?? null,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        currency: input.currency,
        subtotal: String(totals.subtotal),
        discountTotal: String(totals.discountTotal),
        taxTotal: String(totals.taxTotal),
        total: String(totals.total),
        balanceDue: String(totals.total),
      })
      .where(and(eq(invoices.id, id), eq(invoices.businessId, ctx.businessId)));

    await tx.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));

    await tx.insert(invoiceItems).values(
      input.items.map((it, idx) => ({
        invoiceId: id,
        productId: it.product_id,
        productName: productNames.get(it.product_id)!,
        description: it.description ?? null,
        quantity: String(it.quantity),
        unitPrice: String(it.unit_price),
        discountPct: String(it.discount_pct ?? 0),
        taxRate: String(it.tax_rate ?? 0),
        lineSubtotal: String(totals.lines[idx]!.lineSubtotal),
        lineTax: String(totals.lines[idx]!.lineTax),
        lineTotal: String(totals.lines[idx]!.lineTotal),
        sortOrder: idx,
      })),
    );
  });

  return { id };
}

export async function softDeleteInvoice(ctx: Ctx, id: string): Promise<void> {
  const db = getDb();
  const existing = await db
    .select({ status: invoices.status })
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.businessId, ctx.businessId)))
    .limit(1);
  const row = existing[0];
  if (!row) throw notFoundError('Invoice not found');
  if (row.status !== 'draft') {
    throw conflictError('Only draft invoices can be deleted');
  }
  await db
    .update(invoices)
    .set({ deletedAt: new Date() })
    .where(and(eq(invoices.id, id), eq(invoices.businessId, ctx.businessId)));
}

/**
 * Recompute amount_paid, balance_due, status from current payment rows.
 * Idempotent. Called after status changes or payment add/remove.
 */
export async function recomputeInvoiceStatus(
  ctx: Ctx,
  invoiceId: string,
): Promise<void> {
  const db = getDb();
  const invRows = await db
    .select({
      total: invoices.total,
      dueDate: invoices.dueDate,
      status: invoices.status,
    })
    .from(invoices)
    .where(
      and(eq(invoices.id, invoiceId), eq(invoices.businessId, ctx.businessId)),
    )
    .limit(1);
  const inv = invRows[0];
  if (!inv) return;

  const payRows = await db
    .select({ amount: payments.amount })
    .from(payments)
    .where(
      and(eq(payments.invoiceId, invoiceId), isNull(payments.deletedAt)),
    );

  const r = applyPayments(
    Number(inv.total),
    payRows.map((p) => ({ amount: Number(p.amount) })),
    { dueDate: inv.dueDate, currentStatus: inv.status as InvoiceStatus },
  );

  await db
    .update(invoices)
    .set({
      amountPaid: String(r.amountPaid),
      balanceDue: String(r.balanceDue),
      status: r.status,
    })
    .where(eq(invoices.id, invoiceId));
}

export async function changeInvoiceStatus(
  ctx: Ctx,
  id: string,
  target: 'draft' | 'issued' | 'cancelled',
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(invoices)
    .set({ status: target })
    .where(and(eq(invoices.id, id), eq(invoices.businessId, ctx.businessId)))
    .returning({ id: invoices.id });
  if (updated.length === 0) throw notFoundError('Invoice not found');
  await recomputeInvoiceStatus(ctx, id);
}

export async function addPayment(
  ctx: Ctx,
  input: PaymentInput,
): Promise<void> {
  const db = getDb();
  // Verify invoice belongs to business
  const invRows = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.id, input.invoice_id),
        eq(invoices.businessId, ctx.businessId),
      ),
    )
    .limit(1);
  if (invRows.length === 0) throw notFoundError('Invoice not found');

  await db.insert(payments).values({
    businessId: ctx.businessId,
    invoiceId: input.invoice_id,
    paymentDate: input.payment_date,
    amount: String(input.amount),
    method: input.method,
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    createdBy: ctx.userId,
  });
  await recomputeInvoiceStatus(ctx, input.invoice_id);
}

export async function removePayment(
  ctx: Ctx,
  invoiceId: string,
  paymentId: string,
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(payments)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(payments.id, paymentId),
        eq(payments.invoiceId, invoiceId),
        eq(payments.businessId, ctx.businessId),
      ),
    )
    .returning({ id: payments.id });
  if (updated.length === 0) throw notFoundError('Payment not found');
  await recomputeInvoiceStatus(ctx, invoiceId);
}

export type InvoiceListRow = {
  id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  status: InvoiceStatus;
  total: string;
  balance_due: string;
  currency: string;
  customer: { name: string; company_name: string | null } | null;
};

export async function listInvoices(
  ctx: Ctx,
  params: { q?: string; status?: InvoiceStatus; page: number; size: number },
): Promise<{ rows: InvoiceListRow[]; count: number }> {
  const db = getDb();
  const conditions = [
    eq(invoices.businessId, ctx.businessId),
    isNull(invoices.deletedAt),
  ];
  if (params.status) conditions.push(eq(invoices.status, params.status));
  if (params.q?.trim()) {
    const term = `%${params.q.trim()}%`;
    conditions.push(
      or(ilike(invoices.invoiceNumber, term), ilike(customers.name, term))!,
    );
  }
  const whereClause = and(...conditions);

  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: invoices.id,
        invoice_number: invoices.invoiceNumber,
        issue_date: invoices.issueDate,
        due_date: invoices.dueDate,
        status: invoices.status,
        total: invoices.total,
        balance_due: invoices.balanceDue,
        currency: invoices.currency,
        customerName: customers.name,
        customerCompanyName: customers.companyName,
      })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(whereClause)
      .orderBy(desc(invoices.issueDate))
      .limit(params.size)
      .offset((params.page - 1) * params.size),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(whereClause),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      invoice_number: r.invoice_number,
      issue_date: r.issue_date,
      due_date: r.due_date,
      status: r.status as InvoiceStatus,
      total: r.total,
      balance_due: r.balance_due,
      currency: r.currency,
      customer: { name: r.customerName, company_name: r.customerCompanyName },
    })),
    count: countRows[0]?.count ?? 0,
  };
}

export async function getInvoiceDetail(ctx: Ctx, id: string) {
  const db = getDb();
  const [headerRows, items, paymentRows] = await Promise.all([
    db
      .select({
        invoice: invoices,
        customer: {
          name: customers.name,
          company_name: customers.companyName,
          email: customers.email,
          tax_id: customers.taxId,
          address: customers.address,
          city: customers.city,
          country: customers.country,
        },
        quotation_number: quotations.quotationNumber,
      })
      .from(invoices)
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .leftJoin(quotations, eq(quotations.id, invoices.quotationId))
      .where(and(eq(invoices.id, id), eq(invoices.businessId, ctx.businessId)))
      .limit(1),
    db
      .select()
      .from(invoiceItems)
      .where(eq(invoiceItems.invoiceId, id))
      .orderBy(invoiceItems.sortOrder),
    db
      .select({
        id: payments.id,
        payment_date: payments.paymentDate,
        amount: payments.amount,
        method: payments.method,
        reference: payments.reference,
        notes: payments.notes,
      })
      .from(payments)
      .where(and(eq(payments.invoiceId, id), isNull(payments.deletedAt)))
      .orderBy(desc(payments.paymentDate)),
  ]);
  const row = headerRows[0];
  if (!row) return null;
  return {
    invoice: row.invoice,
    customer: row.customer,
    quotation_number: row.quotation_number,
    items,
    payments: paymentRows,
  };
}

/**
 * Internal fiscal-emission snapshot. Unlike getInvoiceDetail, this function is
 * never returned directly by an API route and intentionally selects only the
 * business fields needed to build the e-CF payload.
 */
export async function getFiscalInvoiceInputs(
  ctx: Ctx,
  id: string,
): Promise<FiscalInvoiceInputs | null> {
  const db = getDb();
  const [headerRows, items] = await Promise.all([
    db
      .select({
        business: {
          fiscalEnabled: businesses.fiscalEnabled,
          fiscalDefaultDocumentType: businesses.fiscalDefaultDocumentType,
          fiscalDefaultTipoIngresos: businesses.fiscalDefaultTipoIngresos,
          taxId: businesses.taxId,
          name: businesses.name,
          legalName: businesses.legalName,
          email: businesses.email,
          phone: businesses.phone,
          address: businesses.address,
          fiscalTradeName: businesses.fiscalTradeName,
          fiscalBranch: businesses.fiscalBranch,
          fiscalEconomicActivity: businesses.fiscalEconomicActivity,
          fiscalMunicipality: businesses.fiscalMunicipality,
          fiscalProvince: businesses.fiscalProvince,
        },
        customer: {
          name: customers.name,
          companyName: customers.companyName,
          taxId: customers.taxId,
          email: customers.email,
          address: customers.address,
          city: customers.city,
        },
        invoice: {
          id: invoices.id,
          issueDate: invoices.issueDate,
          dueDate: invoices.dueDate,
          currency: invoices.currency,
          subtotal: invoices.subtotal,
          discountTotal: invoices.discountTotal,
          taxTotal: invoices.taxTotal,
          total: invoices.total,
          amountPaid: invoices.amountPaid,
          balanceDue: invoices.balanceDue,
        },
      })
      .from(invoices)
      .innerJoin(businesses, eq(businesses.id, invoices.businessId))
      .innerJoin(customers, eq(customers.id, invoices.customerId))
      .where(
        and(
          eq(invoices.id, id),
          eq(invoices.businessId, ctx.businessId),
          isNull(invoices.deletedAt),
        ),
      )
      .limit(1),
    db
      .select({
        productName: invoiceItems.productName,
        description: invoiceItems.description,
        quantity: invoiceItems.quantity,
        unitPrice: invoiceItems.unitPrice,
        discountPct: invoiceItems.discountPct,
        taxRate: invoiceItems.taxRate,
        lineSubtotal: invoiceItems.lineSubtotal,
        lineTax: invoiceItems.lineTax,
        lineTotal: invoiceItems.lineTotal,
        sortOrder: invoiceItems.sortOrder,
      })
      .from(invoiceItems)
      .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
      .where(
        and(
          eq(invoiceItems.invoiceId, id),
          eq(invoices.businessId, ctx.businessId),
          isNull(invoices.deletedAt),
        ),
      )
      .orderBy(invoiceItems.sortOrder),
  ]);
  const row = headerRows[0];
  if (!row) return null;
  return { ...row, items };
}
