import { and, desc, eq, ilike, isNull, notInArray, or, sql } from 'drizzle-orm';
import {
  businesses,
  customers,
  invoiceItems,
  invoices,
  quotationItems,
  quotations,
} from '@crm/db/schema';
import type {
  QuotationInput,
  QuotationStatus,
} from '@crm/contracts/quotation';
import { calculateTotals } from '@crm/core/money';
import { getDb } from '../lib/db';
import {
  conflictError,
  notFoundError,
  validationError,
} from '../lib/errors';
import type { Ctx } from '../middleware/auth';
import { getProductNamesByIds } from './products';

function computeDocumentTotals(items: QuotationInput['items']) {
  return calculateTotals(
    items.map((i) => ({
      quantity: i.quantity,
      unitPrice: i.unit_price,
      discountPct: i.discount_pct ?? 0,
      taxRate: i.tax_rate ?? 0,
    })),
  );
}

async function nextQuotationNumber(businessId: string): Promise<string> {
  const db = getDb();
  const result = await db.execute<{ next_quotation_number: string }>(
    sql`select public.next_quotation_number(${businessId}::uuid) as next_quotation_number`,
  );
  const value = result.rows[0]?.next_quotation_number;
  if (!value) throw new Error('Failed to allocate quotation number');
  return value;
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

export async function createQuotation(
  ctx: Ctx,
  input: QuotationInput,
): Promise<{ id: string; quotation_number: string }> {
  const db = getDb();
  const totals = computeDocumentTotals(input.items);
  const productNames = await getProductNamesByIds(
    ctx,
    input.items.map((i) => i.product_id),
  );
  const quotationNumber = await nextQuotationNumber(ctx.businessId);

  return await db.transaction(async (tx) => {
    const [header] = await tx
      .insert(quotations)
      .values({
        businessId: ctx.businessId,
        customerId: input.customer_id,
        quotationNumber,
        issueDate: input.issue_date,
        expiryDate: input.expiry_date ?? null,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        currency: input.currency,
        status: 'draft',
        subtotal: String(totals.subtotal),
        discountTotal: String(totals.discountTotal),
        taxTotal: String(totals.taxTotal),
        total: String(totals.total),
        createdBy: ctx.userId,
      })
      .returning({ id: quotations.id });
    if (!header) throw new Error('Quotation insert returned no row');

    await tx.insert(quotationItems).values(
      input.items.map((it, idx) => ({
        quotationId: header.id,
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

    return { id: header.id, quotation_number: quotationNumber };
  });
}

export async function updateQuotation(
  ctx: Ctx,
  id: string,
  input: QuotationInput,
): Promise<{ id: string }> {
  const db = getDb();
  const totals = computeDocumentTotals(input.items);
  const productNames = await getProductNamesByIds(
    ctx,
    input.items.map((i) => i.product_id),
  );

  const existing = await db
    .select({
      status: quotations.status,
      convertedInvoiceId: quotations.convertedInvoiceId,
    })
    .from(quotations)
    .where(
      and(eq(quotations.id, id), eq(quotations.businessId, ctx.businessId)),
    )
    .limit(1);
  const row = existing[0];
  if (!row) throw notFoundError('Quotation not found');
  if (row.convertedInvoiceId) {
    throw conflictError('Already converted to invoice; cannot edit.');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(quotations)
      .set({
        customerId: input.customer_id,
        issueDate: input.issue_date,
        expiryDate: input.expiry_date ?? null,
        notes: input.notes ?? null,
        terms: input.terms ?? null,
        currency: input.currency,
        subtotal: String(totals.subtotal),
        discountTotal: String(totals.discountTotal),
        taxTotal: String(totals.taxTotal),
        total: String(totals.total),
      })
      .where(
        and(eq(quotations.id, id), eq(quotations.businessId, ctx.businessId)),
      );

    await tx.delete(quotationItems).where(eq(quotationItems.quotationId, id));

    await tx.insert(quotationItems).values(
      input.items.map((it, idx) => ({
        quotationId: id,
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

export async function changeQuotationStatus(
  ctx: Ctx,
  id: string,
  status: QuotationStatus,
): Promise<void> {
  const db = getDb();
  const updated = await db
    .update(quotations)
    .set({ status })
    .where(
      and(eq(quotations.id, id), eq(quotations.businessId, ctx.businessId)),
    )
    .returning({ id: quotations.id });
  if (updated.length === 0) throw notFoundError('Quotation not found');
}

export async function softDeleteQuotation(ctx: Ctx, id: string): Promise<void> {
  const db = getDb();
  const existing = await db
    .select({ convertedInvoiceId: quotations.convertedInvoiceId })
    .from(quotations)
    .where(
      and(eq(quotations.id, id), eq(quotations.businessId, ctx.businessId)),
    )
    .limit(1);
  const row = existing[0];
  if (!row) throw notFoundError('Quotation not found');
  if (row.convertedInvoiceId) {
    throw conflictError('Cannot delete: this quotation is linked to an invoice.');
  }
  await db
    .update(quotations)
    .set({ deletedAt: new Date() })
    .where(
      and(eq(quotations.id, id), eq(quotations.businessId, ctx.businessId)),
    );
}

export async function convertQuotationToInvoice(
  ctx: Ctx,
  quotationId: string,
): Promise<{ id: string; invoice_number: string }> {
  const db = getDb();

  const [quotationRows, itemRows, businessRows] = await Promise.all([
    db
      .select()
      .from(quotations)
      .where(
        and(
          eq(quotations.id, quotationId),
          eq(quotations.businessId, ctx.businessId),
          isNull(quotations.deletedAt),
        ),
      )
      .limit(1),
    db
      .select()
      .from(quotationItems)
      .where(eq(quotationItems.quotationId, quotationId))
      .orderBy(quotationItems.sortOrder),
    db
      .select({ defaultPaymentTermsDays: businesses.defaultPaymentTermsDays })
      .from(businesses)
      .where(eq(businesses.id, ctx.businessId))
      .limit(1),
  ]);

  const q = quotationRows[0];
  if (!q) throw notFoundError('Quotation not found');
  if (q.convertedInvoiceId) {
    throw conflictError('This quotation has already been converted.');
  }
  if (q.status !== 'accepted') {
    throw validationError('Only accepted quotations can be converted.');
  }

  const today = new Date().toISOString().slice(0, 10);
  const termsDays = businessRows[0]?.defaultPaymentTermsDays ?? 30;
  const due = new Date();
  due.setDate(due.getDate() + termsDays);
  const dueDate = due.toISOString().slice(0, 10);

  const invoiceNumber = await nextInvoiceNumber(ctx.businessId);

  return await db.transaction(async (tx) => {
    const [invoiceHeader] = await tx
      .insert(invoices)
      .values({
        businessId: ctx.businessId,
        customerId: q.customerId,
        quotationId: q.id,
        invoiceNumber,
        issueDate: today,
        dueDate,
        status: 'draft',
        notes: q.notes,
        terms: q.terms,
        subtotal: q.subtotal,
        discountTotal: q.discountTotal,
        taxTotal: q.taxTotal,
        total: q.total,
        amountPaid: '0',
        balanceDue: q.total,
        currency: q.currency,
        createdBy: ctx.userId,
      })
      .returning({ id: invoices.id });
    if (!invoiceHeader) throw new Error('Invoice insert returned no row');

    if (itemRows.length > 0) {
      await tx.insert(invoiceItems).values(
        itemRows.map((it) => ({
          invoiceId: invoiceHeader.id,
          productId: it.productId,
          productName: it.productName,
          description: it.description,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          discountPct: it.discountPct,
          taxRate: it.taxRate,
          lineSubtotal: it.lineSubtotal,
          lineTax: it.lineTax,
          lineTotal: it.lineTotal,
          sortOrder: it.sortOrder,
        })),
      );
    }

    await tx
      .update(quotations)
      .set({ convertedInvoiceId: invoiceHeader.id })
      .where(eq(quotations.id, q.id));

    return { id: invoiceHeader.id, invoice_number: invoiceNumber };
  });
}

export type QuotationListRow = {
  id: string;
  quotation_number: string;
  issue_date: string;
  expiry_date: string | null;
  status: QuotationStatus;
  total: string;
  currency: string;
  customer: { name: string; company_name: string | null } | null;
};

export async function listQuotations(
  ctx: Ctx,
  params: {
    q?: string;
    status?: QuotationStatus;
    page: number;
    size: number;
    availableForInvoice?: boolean;
  },
): Promise<{ rows: QuotationListRow[]; count: number }> {
  const db = getDb();
  const conditions = [
    eq(quotations.businessId, ctx.businessId),
    isNull(quotations.deletedAt),
  ];
  if (params.status) conditions.push(eq(quotations.status, params.status));
  if (params.availableForInvoice) {
    conditions.push(isNull(quotations.convertedInvoiceId));
    conditions.push(notInArray(quotations.status, ['rejected', 'expired']));
  }
  if (params.q?.trim()) {
    const term = `%${params.q.trim()}%`;
    conditions.push(
      or(ilike(quotations.quotationNumber, term), ilike(customers.name, term))!,
    );
  }
  const whereClause = and(...conditions);

  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: quotations.id,
        quotation_number: quotations.quotationNumber,
        issue_date: quotations.issueDate,
        expiry_date: quotations.expiryDate,
        status: quotations.status,
        total: quotations.total,
        currency: quotations.currency,
        customerName: customers.name,
        customerCompanyName: customers.companyName,
      })
      .from(quotations)
      .innerJoin(customers, eq(customers.id, quotations.customerId))
      .where(whereClause)
      .orderBy(desc(quotations.issueDate))
      .limit(params.size)
      .offset((params.page - 1) * params.size),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(quotations)
      .innerJoin(customers, eq(customers.id, quotations.customerId))
      .where(whereClause),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      quotation_number: r.quotation_number,
      issue_date: r.issue_date,
      expiry_date: r.expiry_date,
      status: r.status as QuotationStatus,
      total: r.total,
      currency: r.currency,
      customer: { name: r.customerName, company_name: r.customerCompanyName },
    })),
    count: countRows[0]?.count ?? 0,
  };
}

export async function getQuotationDetail(ctx: Ctx, id: string) {
  const db = getDb();
  const [headerRows, items] = await Promise.all([
    db
      .select({
        quotation: quotations,
        customer: {
          name: customers.name,
          company_name: customers.companyName,
          email: customers.email,
          tax_id: customers.taxId,
        },
      })
      .from(quotations)
      .innerJoin(customers, eq(customers.id, quotations.customerId))
      .where(
        and(eq(quotations.id, id), eq(quotations.businessId, ctx.businessId)),
      )
      .limit(1),
    db
      .select()
      .from(quotationItems)
      .where(eq(quotationItems.quotationId, id))
      .orderBy(quotationItems.sortOrder),
  ]);
  const row = headerRows[0];
  if (!row) return null;
  return { quotation: row.quotation, customer: row.customer, items };
}
