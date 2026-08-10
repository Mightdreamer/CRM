import {
  DocumentType,
  IndicadorBienoServicio,
  IndicadorFacturacion,
  IntegrationMode,
  OperationMode,
  TipoPago,
  type FiscalComprador,
  type FiscalItem,
  type FiscalTipoIngresos,
  type FiscalTotales,
  type InvoiceRequest,
} from '@crm/contracts/fiscal';
import { detectTaxIdKind, isValidTaxId } from '@crm/core/dgii';
import { calculateLine } from '@crm/core/money';

export interface FiscalInvoiceInputs {
  business: {
    fiscalEnabled: boolean;
    fiscalDefaultDocumentType: string;
    fiscalDefaultTipoIngresos: string;
    taxId: string | null;
    name: string;
    legalName: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    fiscalTradeName: string | null;
    fiscalBranch: string | null;
    fiscalEconomicActivity: string | null;
    fiscalMunicipality: string | null;
    fiscalProvince: string | null;
  };
  customer: {
    name: string;
    companyName: string | null;
    taxId: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
  };
  invoice: {
    id: string;
    issueDate: string;
    dueDate: string | null;
    currency: string;
    subtotal: string;
    discountTotal: string;
    taxTotal: string;
    total: string;
    amountPaid: string;
    balanceDue: string;
  };
  items: Array<{
    productName: string;
    description: string | null;
    quantity: string;
    unitPrice: string;
    discountPct: string;
    taxRate: string;
    lineSubtotal: string;
    lineTax: string;
    lineTotal: string;
    sortOrder: number;
  }>;
}

export interface FiscalMapperIssue {
  code: string;
  field: string;
  message: string;
}

export class FiscalMapperError extends Error {
  constructor(public readonly issues: FiscalMapperIssue[]) {
    super(issues[0]?.message ?? 'Invalid fiscal invoice data');
    this.name = 'FiscalMapperError';
  }
}

function issue(code: string, field: string, message: string): never {
  throw new FiscalMapperError([{ code, field, message }]);
}

function requiredText(value: string | null, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    issue('FISCAL_REQUIRED_FIELD', field, `${field} is required for fiscal emission`);
  }
  return normalized;
}

function optionalText(value: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizedTaxId(value: string): string {
  return value.replace(/\D/g, '');
}

function finiteNumber(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    issue('FISCAL_INVALID_NUMBER', field, `${field} must be a finite number`);
  }
  return parsed;
}

function cents(value: string, field: string): number {
  return Math.round(finiteNumber(value, field) * 100);
}

function money(value: number): string {
  return (value / 100).toFixed(2);
}

function assertIsoDate(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) issue('FISCAL_INVALID_DATE', 'date', `Invalid ISO date: ${value}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    issue('FISCAL_INVALID_DATE', 'date', `Invalid calendar date: ${value}`);
  }
}

export function formatDateForDgii(iso: string): string {
  assertIsoDate(iso);
  const [year, month, day] = iso.split('-');
  return `${day}-${month}-${year}`;
}

export function mapTaxRateToIndicator(rate: string): IndicadorFacturacion {
  const numeric = finiteNumber(rate, 'items.taxRate');
  if (Math.abs(numeric - 0.18) < 0.000001) return IndicadorFacturacion.Itbis18;
  if (Math.abs(numeric - 0.16) < 0.000001) return IndicadorFacturacion.Itbis16;
  if (Math.abs(numeric) < 0.000001) return IndicadorFacturacion.Exento;
  return issue(
    'FISCAL_UNSUPPORTED_TAX_RATE',
    'items.taxRate',
    `Unsupported fiscal tax rate: ${rate}`,
  );
}

function documentTypeFor(inputs: FiscalInvoiceInputs): DocumentType.E31 | DocumentType.E32 {
  const kind = detectTaxIdKind(inputs.customer.taxId ?? '');
  if (!kind) {
    issue(
      'FISCAL_CUSTOMER_TAX_ID_INVALID',
      'customer.taxId',
      'Customer must have a valid Dominican RNC or Cédula for fiscal emission',
    );
  }
  return inputs.business.fiscalDefaultDocumentType === 'E32' || kind === 'CEDULA'
    ? DocumentType.E32
    : DocumentType.E31;
}

function assertHeader(inputs: FiscalInvoiceInputs): void {
  if (!inputs.business.fiscalEnabled) {
    issue(
      'FISCAL_NOT_ENABLED',
      'business.fiscalEnabled',
      'Fiscal integration is not enabled for this business',
    );
  }
  if (!inputs.business.taxId || !isValidTaxId(inputs.business.taxId)) {
    issue(
      'FISCAL_BUSINESS_TAX_ID_INVALID',
      'business.taxId',
      'Business must have a valid Dominican RNC or Cédula for fiscal emission',
    );
  }
  requiredText(inputs.business.address, 'business.address');
  if (!inputs.customer.taxId || !isValidTaxId(inputs.customer.taxId)) {
    issue(
      'FISCAL_CUSTOMER_TAX_ID_INVALID',
      'customer.taxId',
      'Customer must have a valid Dominican RNC or Cédula for fiscal emission',
    );
  }
  if (inputs.invoice.currency !== 'DOP') {
    issue(
      'FISCAL_UNSUPPORTED_CURRENCY',
      'invoice.currency',
      'Fiscal emission currently supports DOP invoices only',
    );
  }
  if (inputs.items.length === 0) {
    issue('FISCAL_ITEMS_REQUIRED', 'items', 'Fiscal invoice must contain at least one item');
  }
  assertIsoDate(inputs.invoice.issueDate);
  if (inputs.invoice.dueDate) assertIsoDate(inputs.invoice.dueDate);
}

function mapItems(inputs: FiscalInvoiceInputs): {
  items: FiscalItem[];
  indicators: IndicadorFacturacion[];
  discounts: number[];
} {
  const indicators: IndicadorFacturacion[] = [];
  const discounts: number[] = [];
  const items = inputs.items.map((item, index) => {
    const quantity = finiteNumber(item.quantity, `items[${index}].quantity`);
    if (quantity <= 0 || Math.abs(quantity * 100 - Math.round(quantity * 100)) > 0.000001) {
      issue(
        'FISCAL_QUANTITY_PRECISION_UNSUPPORTED',
        `items[${index}].quantity`,
        'Fiscal item quantity must be positive and have at most two decimals',
      );
    }
    const unitPrice = finiteNumber(item.unitPrice, `items[${index}].unitPrice`);
    const discountPct = finiteNumber(
      item.discountPct,
      `items[${index}].discountPct`,
    );
    const taxRate = finiteNumber(item.taxRate, `items[${index}].taxRate`);
    const indicator = mapTaxRateToIndicator(item.taxRate);
    const subtotalCents = cents(item.lineSubtotal, `items[${index}].lineSubtotal`);
    const computed = calculateLine({ quantity, unitPrice, discountPct, taxRate });
    const discount = Math.round(computed.lineDiscount * 100);
    if (
      subtotalCents !== Math.round(computed.lineSubtotal * 100) ||
      cents(item.lineTax, `items[${index}].lineTax`) !==
        Math.round(computed.lineTax * 100) ||
      cents(item.lineTotal, `items[${index}].lineTotal`) !==
        Math.round(computed.lineTotal * 100)
    ) {
      issue(
        'FISCAL_LINE_TOTALS_INVALID',
        `items[${index}]`,
        'Persisted line totals do not match quantity, price, discount and tax rate',
      );
    }
    indicators.push(indicator);
    discounts.push(discount);
    return {
      numeroLinea: index + 1,
      indicadorFacturacion: indicator,
      nombreItem: requiredText(item.productName, `items[${index}].productName`),
      descripcionItem: optionalText(item.description),
      indicadorBienoServicio: IndicadorBienoServicio.Servicio,
      cantidadItem: quantity.toFixed(2),
      precioUnitarioItem: unitPrice.toFixed(4),
      ...(discount > 0 ? { descuentoMonto: money(discount) } : {}),
      montoItem: money(subtotalCents),
    } satisfies FiscalItem;
  });
  return { items, indicators, discounts };
}

function reconcileAndBuildTotals(
  inputs: FiscalInvoiceInputs,
  indicators: IndicadorFacturacion[],
  discounts: number[],
): FiscalTotales {
  let subtotal = 0;
  let tax = 0;
  let total = 0;
  let discount = 0;
  const bases = new Map<IndicadorFacturacion, number>();
  const taxes = new Map<IndicadorFacturacion, number>();

  inputs.items.forEach((item, index) => {
    const lineSubtotal = cents(item.lineSubtotal, `items[${index}].lineSubtotal`);
    const lineTax = cents(item.lineTax, `items[${index}].lineTax`);
    const lineTotal = cents(item.lineTotal, `items[${index}].lineTotal`);
    if (lineSubtotal + lineTax !== lineTotal) {
      issue(
        'FISCAL_LINE_TOTALS_INVALID',
        `items[${index}].lineTotal`,
        'Line total must equal line subtotal plus line tax',
      );
    }
    discount += discounts[index]!;
    subtotal += lineSubtotal;
    tax += lineTax;
    total += lineTotal;
    const indicator = indicators[index]!;
    bases.set(indicator, (bases.get(indicator) ?? 0) + lineSubtotal);
    taxes.set(indicator, (taxes.get(indicator) ?? 0) + lineTax);
  });

  const expected = {
    subtotal: cents(inputs.invoice.subtotal, 'invoice.subtotal'),
    discount: cents(inputs.invoice.discountTotal, 'invoice.discountTotal'),
    tax: cents(inputs.invoice.taxTotal, 'invoice.taxTotal'),
    total: cents(inputs.invoice.total, 'invoice.total'),
  };
  if (
    subtotal !== expected.subtotal ||
    discount !== expected.discount ||
    tax !== expected.tax ||
    total !== expected.total
  ) {
    issue(
      'FISCAL_TOTALS_MISMATCH',
      'invoice',
      'Persisted invoice totals do not match the fiscal line totals',
    );
  }

  const taxableBase =
    (bases.get(IndicadorFacturacion.Itbis18) ?? 0) +
    (bases.get(IndicadorFacturacion.Itbis16) ?? 0);
  const amountPaid = cents(inputs.invoice.amountPaid, 'invoice.amountPaid');
  const balanceDue = cents(inputs.invoice.balanceDue, 'invoice.balanceDue');
  if (amountPaid < 0 || balanceDue < 0 || amountPaid + balanceDue !== total) {
    issue(
      'FISCAL_PAYMENT_TOTALS_MISMATCH',
      'invoice.balanceDue',
      'Amount paid plus balance due must equal the invoice total',
    );
  }

  return {
    ...(taxableBase > 0 ? { montoGravadoTotal: money(taxableBase) } : {}),
    ...((bases.get(IndicadorFacturacion.Itbis18) ?? 0) > 0
      ? {
          montoGravadoI1: money(bases.get(IndicadorFacturacion.Itbis18)!),
          itbis1: 18,
          totalITBIS1: money(taxes.get(IndicadorFacturacion.Itbis18) ?? 0),
        }
      : {}),
    ...((bases.get(IndicadorFacturacion.Itbis16) ?? 0) > 0
      ? {
          montoGravadoI2: money(bases.get(IndicadorFacturacion.Itbis16)!),
          itbis2: 16,
          totalITBIS2: money(taxes.get(IndicadorFacturacion.Itbis16) ?? 0),
        }
      : {}),
    ...((bases.get(IndicadorFacturacion.Exento) ?? 0) > 0
      ? { montoExento: money(bases.get(IndicadorFacturacion.Exento)!) }
      : {}),
    ...(tax > 0 ? { totalITBIS: money(tax) } : {}),
    montoTotal: money(total),
    ...(amountPaid > 0
      ? { montoAvancePago: money(amountPaid), valorPagar: money(balanceDue) }
      : {}),
  };
}

export function buildInvoiceRequest(inputs: FiscalInvoiceInputs): InvoiceRequest {
  assertHeader(inputs);
  const documentType = documentTypeFor(inputs);
  const { items, indicators, discounts } = mapItems(inputs);
  const totales = reconcileAndBuildTotals(inputs, indicators, discounts);
  const isCredit =
    inputs.invoice.dueDate !== null &&
    inputs.invoice.dueDate > inputs.invoice.issueDate;
  const customerTaxId = normalizedTaxId(inputs.customer.taxId!);
  const comprador: FiscalComprador = {
    rncComprador: customerTaxId,
    razonSocialComprador:
      optionalText(inputs.customer.companyName) ?? requiredText(inputs.customer.name, 'customer.name'),
    correoComprador: optionalText(inputs.customer.email),
    direccionComprador: optionalText(inputs.customer.address),
    municipioComprador: optionalText(inputs.customer.city),
  };
  const hasTaxableItems = indicators.some(
    (value) =>
      value === IndicadorFacturacion.Itbis18 ||
      value === IndicadorFacturacion.Itbis16,
  );

  const base = {
    documentType,
    operationMode: OperationMode.CLOUD,
    integrationMode: IntegrationMode.JSON,
    externalReference: inputs.invoice.id,
    idDoc: {
      version: '1.0',
      tipoeCF: documentType,
      tipoIngresos: inputs.business
        .fiscalDefaultTipoIngresos as FiscalTipoIngresos,
      tipoPago: isCredit ? TipoPago.Credito : TipoPago.Contado,
      ...(isCredit
        ? { fechaLimitePago: formatDateForDgii(inputs.invoice.dueDate!) }
        : {}),
      ...(documentType === DocumentType.E32 && hasTaxableItems
        ? { indicadorMontoGravado: 1 }
        : {}),
    },
    emisor: {
      rncEmisor: normalizedTaxId(inputs.business.taxId!),
      razonSocialEmisor:
        optionalText(inputs.business.legalName) ?? requiredText(inputs.business.name, 'business.name'),
      nombreComercial:
        optionalText(inputs.business.fiscalTradeName) ?? requiredText(inputs.business.name, 'business.name'),
      sucursal: optionalText(inputs.business.fiscalBranch),
      direccionEmisor: requiredText(inputs.business.address, 'business.address'),
      municipio: optionalText(inputs.business.fiscalMunicipality),
      provincia: optionalText(inputs.business.fiscalProvince),
      telefonosEmisor: optionalText(inputs.business.phone)
        ? [inputs.business.phone!.trim()]
        : undefined,
      correoEmisor: optionalText(inputs.business.email),
      actividadEconomica: optionalText(inputs.business.fiscalEconomicActivity),
      fechaEmision: formatDateForDgii(inputs.invoice.issueDate),
    },
    comprador,
    items,
    totales,
  };

  return base as InvoiceRequest;
}
