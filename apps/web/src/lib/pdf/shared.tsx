import { StyleSheet } from '@react-pdf/renderer';

export const pdfStyles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    padding: 36,
    color: '#1a1a1a',
    lineHeight: 1.4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  businessBlock: {
    maxWidth: 240,
  },
  businessName: {
    fontSize: 14,
    fontWeight: 700,
    marginBottom: 4,
  },
  muted: {
    color: '#666666',
  },
  docMeta: {
    textAlign: 'right',
  },
  docTitle: {
    fontSize: 18,
    fontWeight: 700,
    marginBottom: 4,
  },
  docNumber: {
    fontSize: 11,
    color: '#666666',
  },
  sectionLabel: {
    fontSize: 9,
    color: '#666666',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  customerBlock: {
    marginBottom: 18,
  },
  table: {
    marginTop: 4,
    marginBottom: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#dddddd',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f6f6f6',
    paddingVertical: 6,
    paddingHorizontal: 6,
    fontSize: 9,
    color: '#444',
    textTransform: 'uppercase',
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderTopWidth: 0.5,
    borderColor: '#eeeeee',
  },
  col: {
    paddingHorizontal: 4,
  },
  colDescription: {
    flex: 4,
  },
  lineProductName: {
    fontWeight: 700,
  },
  lineDescription: {
    fontSize: 8,
    color: '#666666',
    marginTop: 2,
  },
  colNumber: {
    flex: 1,
    textAlign: 'right',
  },
  colSmall: {
    flex: 0.7,
    textAlign: 'right',
  },
  totalsBlock: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  totalsTable: {
    width: 220,
  },
  totalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  totalsRowBold: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderTopWidth: 1,
    borderColor: '#cccccc',
    marginTop: 4,
    fontWeight: 700,
  },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 36,
    right: 36,
    textAlign: 'center',
    fontSize: 8,
    color: '#999999',
  },
  notes: {
    marginTop: 16,
    fontSize: 9,
  },
  notesLabel: {
    color: '#666666',
    marginBottom: 2,
    textTransform: 'uppercase',
    fontSize: 8,
  },
});

export type BusinessForPdf = {
  name: string;
  legal_name?: string | null;
  tax_id?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  logo_url?: string | null;
  pdf_settings?: {
    primary_color?: string;
    footer_text?: string;
    show_logo?: boolean;
  } | null;
};

export type CustomerForPdf = {
  name: string;
  company_name?: string | null;
  tax_id?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
};

export type LineForPdf = {
  product_name: string;
  description: string | null;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  tax_rate: number;
  line_total: number;
};
