import { Document, Image, Page, Text, View } from '@react-pdf/renderer';
import { formatMoney } from '@crm/core/money';
import {
  pdfStyles as s,
  type BusinessForPdf,
  type CustomerForPdf,
  type LineForPdf,
} from './shared';

export type QuotationPdfData = {
  business: BusinessForPdf;
  customer: CustomerForPdf;
  quotation: {
    quotation_number: string;
    issue_date: string;
    expiry_date?: string | null;
    notes?: string | null;
    terms?: string | null;
    subtotal: number;
    discount_total: number;
    tax_total: number;
    total: number;
    currency: string;
  };
  items: LineForPdf[];
  /** Localized labels — passed in so the PDF stays "dumb" about i18n. */
  labels: {
    documentTitle: string;
    issueDate: string;
    expiryDate: string;
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
    notes: string;
    terms: string;
    pageOf: (current: number, total: number) => string;
  };
};

export function QuotationPDF({ business, customer, quotation, items, labels }: QuotationPdfData) {
  const fmt = (n: number) =>
    formatMoney(Number(n), { currency: quotation.currency, locale: 'en-US' });

  const primaryColor = business.pdf_settings?.primary_color ?? '#1a1a1a';
  const footerText = business.pdf_settings?.footer_text;
  const showLogo = business.pdf_settings?.show_logo ?? true;

  return (
    <Document>
      <Page size="LETTER" style={s.page}>
        {/* Header */}
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
            <Text style={s.docNumber}>{quotation.quotation_number}</Text>
            <Text style={{ marginTop: 8 }}>
              {labels.issueDate}: <Text style={s.muted}>{quotation.issue_date}</Text>
            </Text>
            {quotation.expiry_date && (
              <Text>
                {labels.expiryDate}: <Text style={s.muted}>{quotation.expiry_date}</Text>
              </Text>
            )}
          </View>
        </View>

        {/* Customer */}
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

        {/* Items table */}
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

        {/* Totals */}
        <View style={s.totalsBlock}>
          <View style={s.totalsTable}>
            <View style={s.totalsRow}>
              <Text style={s.muted}>{labels.subtotal}</Text>
              <Text>{fmt(Number(quotation.subtotal))}</Text>
            </View>
            {Number(quotation.discount_total) > 0 && (
              <View style={s.totalsRow}>
                <Text style={s.muted}>{labels.discountTotal}</Text>
                <Text>-{fmt(Number(quotation.discount_total))}</Text>
              </View>
            )}
            <View style={s.totalsRow}>
              <Text style={s.muted}>{labels.taxTotal}</Text>
              <Text>{fmt(Number(quotation.tax_total))}</Text>
            </View>
            <View style={s.totalsRowBold}>
              <Text>{labels.total}</Text>
              <Text>{fmt(Number(quotation.total))}</Text>
            </View>
          </View>
        </View>

        {/* Notes / Terms */}
        {quotation.notes && (
          <View style={s.notes}>
            <Text style={s.notesLabel}>{labels.notes}</Text>
            <Text>{quotation.notes}</Text>
          </View>
        )}
        {quotation.terms && (
          <View style={s.notes}>
            <Text style={s.notesLabel}>{labels.terms}</Text>
            <Text>{quotation.terms}</Text>
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
