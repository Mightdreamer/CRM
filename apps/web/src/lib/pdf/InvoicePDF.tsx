import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import { formatMoney } from '@crm/core/money';
import {
  pdfStyles as s,
  type BusinessForPdf,
  type CustomerForPdf,
  type LineForPdf,
} from './shared';

export type InvoicePdfData = {
  business: BusinessForPdf;
  customer: CustomerForPdf;
  invoice: {
    invoice_number: string;
    issue_date: string;
    due_date?: string | null;
    status: string;
    notes?: string | null;
    terms?: string | null;
    subtotal: number;
    discount_total: number;
    tax_total: number;
    total: number;
    amount_paid: number;
    balance_due: number;
    currency: string;
  };
  items: LineForPdf[];
  labels: {
    documentTitle: string;
    issueDate: string;
    dueDate: string;
    billTo: string;
    description: string;
    quantity: string;
    unitPrice: string;
    discount: string;
    taxRate: string;
    lineTotal: string;
    subtotal: string;
    discountTotal: string;
    taxTotal: string;
    total: string;
    amountPaid: string;
    balanceDue: string;
    statusLabel: string;
    notes: string;
    terms: string;
    pageOf: (current: number, total: number) => string;
  };
};

export function InvoicePDF({ business, customer, invoice, items, labels }: InvoicePdfData) {
  const fmt = (n: number) =>
    formatMoney(Number(n), { currency: invoice.currency, locale: 'en-US' });

  const primaryColor = business.pdf_settings?.primary_color ?? '#1a1a1a';
  const footerText = business.pdf_settings?.footer_text;
  const showLogo = business.pdf_settings?.show_logo ?? true;

  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        <View style={s.headerRow}>
          <View style={s.businessBlock}>
            {showLogo && business.logo_url && (
              <Image src={business.logo_url} style={{ maxHeight: 48, marginBottom: 8 }} />
            )}
            <Text style={[s.businessName, { color: primaryColor }]}>{business.name}</Text>
            {business.legal_name && <Text style={s.muted}>{business.legal_name}</Text>}
            {business.tax_id && <Text style={s.muted}>RNC: {business.tax_id}</Text>}
            {business.address && <Text style={s.muted}>{business.address}</Text>}
            {business.city && (
              <Text style={s.muted}>
                {business.city}
                {business.country ? `, ${business.country}` : ''}
              </Text>
            )}
            {business.email && <Text style={s.muted}>{business.email}</Text>}
            {business.phone && <Text style={s.muted}>{business.phone}</Text>}
          </View>
          <View style={s.docMeta}>
            <Text style={[s.docTitle, { color: primaryColor }]}>{labels.documentTitle}</Text>
            <Text style={s.docNumber}>{invoice.invoice_number}</Text>
            <Text style={{ marginTop: 6, fontSize: 9, color: '#666' }}>
              {labels.statusLabel}: {invoice.status.toUpperCase()}
            </Text>
            <Text style={{ marginTop: 8 }}>
              {labels.issueDate}: <Text style={s.muted}>{invoice.issue_date}</Text>
            </Text>
            {invoice.due_date && (
              <Text>
                {labels.dueDate}: <Text style={s.muted}>{invoice.due_date}</Text>
              </Text>
            )}
          </View>
        </View>

        <View style={s.customerBlock}>
          <Text style={s.sectionLabel}>{labels.billTo}</Text>
          <Text style={{ fontWeight: 700 }}>{customer.company_name || customer.name}</Text>
          {customer.company_name && customer.name && (
            <Text style={s.muted}>{customer.name}</Text>
          )}
          {customer.tax_id && <Text style={s.muted}>{customer.tax_id}</Text>}
          {customer.address && <Text style={s.muted}>{customer.address}</Text>}
          {customer.city && (
            <Text style={s.muted}>
              {customer.city}
              {customer.country ? `, ${customer.country}` : ''}
            </Text>
          )}
          {customer.email && <Text style={s.muted}>{customer.email}</Text>}
        </View>

        <View style={s.table}>
          <View style={s.tableHeader}>
            <Text style={[s.col, s.colDescription]}>{labels.description}</Text>
            <Text style={[s.col, s.colSmall]}>{labels.quantity}</Text>
            <Text style={[s.col, s.colNumber]}>{labels.unitPrice}</Text>
            <Text style={[s.col, s.colSmall]}>{labels.discount}</Text>
            <Text style={[s.col, s.colSmall]}>{labels.taxRate}</Text>
            <Text style={[s.col, s.colNumber]}>{labels.lineTotal}</Text>
          </View>
          {items.map((it, i) => (
            <View key={i} style={s.tableRow}>
              <View style={[s.col, s.colDescription]}>
                <Text style={s.lineProductName}>{it.product_name}</Text>
                {it.description && (
                  <Text style={s.lineDescription}>{it.description}</Text>
                )}
              </View>
              <Text style={[s.col, s.colSmall]}>{Number(it.quantity)}</Text>
              <Text style={[s.col, s.colNumber]}>{fmt(Number(it.unit_price))}</Text>
              <Text style={[s.col, s.colSmall]}>
                {(Number(it.discount_pct) * 100).toFixed(1)}%
              </Text>
              <Text style={[s.col, s.colSmall]}>
                {(Number(it.tax_rate) * 100).toFixed(1)}%
              </Text>
              <Text style={[s.col, s.colNumber]}>{fmt(Number(it.line_total))}</Text>
            </View>
          ))}
        </View>

        <View style={s.totalsBlock}>
          <View style={s.totalsTable}>
            <View style={s.totalsRow}>
              <Text style={s.muted}>{labels.subtotal}</Text>
              <Text>{fmt(Number(invoice.subtotal))}</Text>
            </View>
            {Number(invoice.discount_total) > 0 && (
              <View style={s.totalsRow}>
                <Text style={s.muted}>{labels.discountTotal}</Text>
                <Text>-{fmt(Number(invoice.discount_total))}</Text>
              </View>
            )}
            <View style={s.totalsRow}>
              <Text style={s.muted}>{labels.taxTotal}</Text>
              <Text>{fmt(Number(invoice.tax_total))}</Text>
            </View>
            <View style={s.totalsRowBold}>
              <Text>{labels.total}</Text>
              <Text>{fmt(Number(invoice.total))}</Text>
            </View>
            {Number(invoice.amount_paid) > 0 && (
              <>
                <View style={[s.totalsRow, { marginTop: 4 }]}>
                  <Text style={s.muted}>{labels.amountPaid}</Text>
                  <Text>{fmt(Number(invoice.amount_paid))}</Text>
                </View>
                <View style={s.totalsRowBold}>
                  <Text>{labels.balanceDue}</Text>
                  <Text>{fmt(Number(invoice.balance_due))}</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {invoice.notes && (
          <View style={s.notes}>
            <Text style={s.notesLabel}>{labels.notes}</Text>
            <Text>{invoice.notes}</Text>
          </View>
        )}
        {invoice.terms && (
          <View style={s.notes}>
            <Text style={s.notesLabel}>{labels.terms}</Text>
            <Text>{invoice.terms}</Text>
          </View>
        )}

        <Text
          style={s.footer}
          render={({ pageNumber, totalPages }) =>
            footerText
              ? `${footerText}  ·  ${labels.pageOf(pageNumber, totalPages)}`
              : labels.pageOf(pageNumber, totalPages)
          }
          fixed
        />
      </Page>
    </Document>
  );
}
