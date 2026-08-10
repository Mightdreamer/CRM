import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Postgres bytea ⇄ Node Buffer. Used for at-rest ciphertext columns
// (e.g. fiscal-platform API keys ciphered with AES-256-GCM).
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// auth.users is managed by Supabase; we only reference its id type.
// For Drizzle we just use a `uuid` column referencing the string id;
// the actual FK constraint already exists in the Supabase migration.

export const businesses = pgTable('businesses', {
  id: uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  name: text('name').notNull(),
  legalName: text('legal_name'),
  taxId: text('tax_id'),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  city: text('city'),
  country: text('country').default('DO'),
  logoUrl: text('logo_url'),
  defaultCurrency: text('default_currency').notNull().default('DOP'),
  defaultTaxRate: decimal('default_tax_rate', { precision: 5, scale: 4 })
    .notNull()
    .default('0.18'),
  defaultPaymentTermsDays: integer('default_payment_terms_days')
    .notNull()
    .default(30),
  invoicePrefix: text('invoice_prefix').notNull().default('INV-'),
  invoiceNextNumber: integer('invoice_next_number').notNull().default(1),
  quotationPrefix: text('quotation_prefix').notNull().default('QUO-'),
  quotationNextNumber: integer('quotation_next_number').notNull().default(1),
  pdfSettings: jsonb('pdf_settings').notNull().default(sql`'{}'::jsonb`),
  // Phase 3: subscription state
  subscriptionStatus: text('subscription_status').notNull().default('trial'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  currentPeriodEndsAt: timestamp('current_period_ends_at', { withTimezone: true }),
  monthlyPriceDop: decimal('monthly_price_dop', { precision: 14, scale: 2 }),
  pastDueSince: timestamp('past_due_since', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  // Fiscal integration — staff-only provisioning (see docs/FISCAL_INTEGRATION_PLAN.md)
  fiscalEnabled: boolean('fiscal_enabled').notNull().default(false),
  fiscalPlatformTenantId: text('fiscal_platform_tenant_id'),
  fiscalPlatformApiKeyEncrypted: bytea('fiscal_platform_api_key_encrypted'),
  fiscalPlatformApiKeyHint: text('fiscal_platform_api_key_hint'),
  fiscalProvisionedAt: timestamp('fiscal_provisioned_at', { withTimezone: true }),
  fiscalIntegrationMode: text('fiscal_integration_mode').notNull().default('JSON'),
  // Fiscal integration — owner-editable Emisor metadata
  fiscalDefaultDocumentType: text('fiscal_default_document_type').notNull().default('E31'),
  fiscalDefaultTipoIngresos: text('fiscal_default_tipo_ingresos').notNull().default('01'),
  fiscalTradeName: text('fiscal_trade_name'),
  fiscalBranch: text('fiscal_branch'),
  fiscalEconomicActivity: text('fiscal_economic_activity'),
  fiscalMunicipality: text('fiscal_municipality'),
  fiscalProvince: text('fiscal_province'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const businessMembers = pgTable(
  'business_members',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    role: text('role').notNull().default('owner'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uqMember: uniqueIndex('business_members_business_user_uq').on(
      t.businessId,
      t.userId,
    ),
    userIdx: index('business_members_user_idx').on(t.userId),
  }),
);

export const customers = pgTable(
  'customers',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    companyName: text('company_name'),
    taxId: text('tax_id'),
    taxIdType: text('tax_id_type'),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    city: text('city'),
    country: text('country').default('DO'),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    businessIdx: index('customers_business_idx').on(t.businessId),
  }),
);

export const products = pgTable(
  'products',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    unitPrice: decimal('unit_price', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    isTaxable: boolean('is_taxable').notNull().default(true),
    taxRateOverride: decimal('tax_rate_override', { precision: 5, scale: 4 }),
    type: text('type').notNull().default('service'),
    sku: text('sku'),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    businessIdx: index('products_business_idx').on(t.businessId),
    skuUq: uniqueIndex('products_business_sku_uq').on(t.businessId, t.sku),
  }),
);

export const quotations = pgTable(
  'quotations',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    quotationNumber: text('quotation_number').notNull(),
    issueDate: date('issue_date').notNull().defaultNow(),
    expiryDate: date('expiry_date'),
    status: text('status').notNull().default('draft'),
    notes: text('notes'),
    terms: text('terms'),
    subtotal: decimal('subtotal', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    discountTotal: decimal('discount_total', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    taxTotal: decimal('tax_total', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    total: decimal('total', { precision: 14, scale: 2 }).notNull().default('0'),
    currency: text('currency').notNull().default('DOP'),
    convertedInvoiceId: uuid('converted_invoice_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    businessIdx: index('quotations_business_idx').on(t.businessId),
    customerIdx: index('quotations_customer_idx').on(t.customerId),
    numberUq: uniqueIndex('quotations_business_number_uq').on(
      t.businessId,
      t.quotationNumber,
    ),
  }),
);

export const quotationItems = pgTable(
  'quotation_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    quotationId: uuid('quotation_id')
      .notNull()
      .references(() => quotations.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, {
      onDelete: 'set null',
    }),
    productName: text('product_name').notNull(),
    description: text('description'),
    quantity: decimal('quantity', { precision: 14, scale: 4 })
      .notNull()
      .default('1'),
    unitPrice: decimal('unit_price', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    discountPct: decimal('discount_pct', { precision: 5, scale: 4 })
      .notNull()
      .default('0'),
    taxRate: decimal('tax_rate', { precision: 5, scale: 4 })
      .notNull()
      .default('0'),
    lineSubtotal: decimal('line_subtotal', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    lineTax: decimal('line_tax', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    lineTotal: decimal('line_total', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    quotationIdx: index('quotation_items_quotation_idx').on(t.quotationId),
  }),
);

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    quotationId: uuid('quotation_id').references(() => quotations.id, {
      onDelete: 'set null',
    }),
    invoiceNumber: text('invoice_number').notNull(),
    issueDate: date('issue_date').notNull().defaultNow(),
    dueDate: date('due_date'),
    status: text('status').notNull().default('draft'),
    notes: text('notes'),
    terms: text('terms'),
    subtotal: decimal('subtotal', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    discountTotal: decimal('discount_total', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    taxTotal: decimal('tax_total', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    total: decimal('total', { precision: 14, scale: 2 }).notNull().default('0'),
    amountPaid: decimal('amount_paid', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    balanceDue: decimal('balance_due', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    currency: text('currency').notNull().default('DOP'),
    fiscalMetadata: jsonb('fiscal_metadata').notNull().default(sql`'{}'::jsonb`),
    fiscalOptOut: boolean('fiscal_opt_out').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    businessIdx: index('invoices_business_idx').on(t.businessId),
    customerIdx: index('invoices_customer_idx').on(t.customerId),
    statusIdx: index('invoices_status_idx').on(t.status),
    numberUq: uniqueIndex('invoices_business_number_uq').on(
      t.businessId,
      t.invoiceNumber,
    ),
  }),
);

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => products.id, {
      onDelete: 'set null',
    }),
    productName: text('product_name').notNull(),
    description: text('description'),
    quantity: decimal('quantity', { precision: 14, scale: 4 })
      .notNull()
      .default('1'),
    unitPrice: decimal('unit_price', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    discountPct: decimal('discount_pct', { precision: 5, scale: 4 })
      .notNull()
      .default('0'),
    taxRate: decimal('tax_rate', { precision: 5, scale: 4 })
      .notNull()
      .default('0'),
    lineSubtotal: decimal('line_subtotal', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    lineTax: decimal('line_tax', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    lineTotal: decimal('line_total', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => ({
    invoiceIdx: index('invoice_items_invoice_idx').on(t.invoiceId),
  }),
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    paymentDate: date('payment_date').notNull().defaultNow(),
    amount: decimal('amount', { precision: 14, scale: 2 }).notNull(),
    method: text('method').notNull(),
    reference: text('reference'),
    notes: text('notes'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    invoiceIdx: index('payments_invoice_idx').on(t.invoiceId),
    businessIdx: index('payments_business_idx').on(t.businessId),
  }),
);

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    vendorName: text('vendor_name').notNull(),
    vendorTaxId: text('vendor_tax_id'),
    expenseDate: date('expense_date').notNull().defaultNow(),
    category: text('category'),
    description: text('description'),
    subtotal: decimal('subtotal', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    taxAmount: decimal('tax_amount', { precision: 14, scale: 2 })
      .notNull()
      .default('0'),
    total: decimal('total', { precision: 14, scale: 2 }).notNull().default('0'),
    currency: text('currency').notNull().default('DOP'),
    hasFiscalReceipt: boolean('has_fiscal_receipt').notNull().default(false),
    fiscalReceiptNumber: text('fiscal_receipt_number'),
    receiptFileUrl: text('receipt_file_url'),
    paymentMethod: text('payment_method'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    businessIdx: index('expenses_business_idx').on(t.businessId),
    dateIdx: index('expenses_date_idx').on(t.expenseDate),
  }),
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    action: text('action').notNull(),
    actorUserId: uuid('actor_user_id'),
    changes: jsonb('changes'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    entityIdx: index('audit_log_entity_idx').on(t.entityType, t.entityId),
    businessTimeIdx: index('audit_log_business_time_idx').on(
      t.businessId,
      t.occurredAt,
    ),
  }),
);

// =====================================================================
// Phase 3: commercial layer (staff, leads, billing audit)
// =====================================================================

export const staffUsers = pgTable('staff_users', {
  userId: uuid('user_id').primaryKey(),
  role: text('role').notNull().default('admin'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const leads = pgTable(
  'leads',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    businessName: text('business_name').notNull(),
    contactName: text('contact_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    rnc: text('rnc'),
    employeesBand: text('employees_band'),
    currentTool: text('current_tool'),
    interestNote: text('interest_note'),
    status: text('status').notNull().default('pending'),
    reviewedBy: uuid('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNotes: text('review_notes'),
    convertedBusinessId: uuid('converted_business_id').references(
      () => businesses.id,
    ),
    turnstileOk: boolean('turnstile_ok').notNull().default(false),
    sourceIp: text('source_ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    statusIdx: index('leads_status_idx').on(t.status, t.createdAt),
    emailIdx: index('leads_email_idx').on(t.email),
  }),
);

export const billingEvents = pgTable(
  'billing_events',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    amountDop: decimal('amount_dop', { precision: 14, scale: 2 }),
    periodExtendedTo: timestamp('period_extended_to', { withTimezone: true }),
    notes: text('notes'),
    actorUserId: uuid('actor_user_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    businessIdx: index('billing_events_business_idx').on(
      t.businessId,
      t.occurredAt,
    ),
  }),
);

// Convenience types
export type Business = typeof businesses.$inferSelect;
export type NewBusiness = typeof businesses.$inferInsert;
export type BusinessMember = typeof businessMembers.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Quotation = typeof quotations.$inferSelect;
export type NewQuotation = typeof quotations.$inferInsert;
export type QuotationItem = typeof quotationItems.$inferSelect;
export type NewQuotationItem = typeof quotationItems.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
export type InvoiceItem = typeof invoiceItems.$inferSelect;
export type NewInvoiceItem = typeof invoiceItems.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
export type AuditLog = typeof auditLog.$inferSelect;
export type StaffUser = typeof staffUsers.$inferSelect;
export type NewStaffUser = typeof staffUsers.$inferInsert;
export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type BillingEvent = typeof billingEvents.$inferSelect;
export type NewBillingEvent = typeof billingEvents.$inferInsert;
