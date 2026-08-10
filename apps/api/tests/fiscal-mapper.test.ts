import {
  DocumentType,
  IndicadorFacturacion,
  TipoPago,
} from '@crm/contracts/fiscal';
import { describe, expect, it } from 'vitest';
import {
  buildInvoiceRequest,
  FiscalMapperError,
  formatDateForDgii,
  mapTaxRateToIndicator,
  type FiscalInvoiceInputs,
} from '../src/lib/fiscal-platform/mapper';

function validInputs(): FiscalInvoiceInputs {
  return {
    business: {
      fiscalEnabled: true,
      fiscalDefaultDocumentType: 'E31',
      fiscalDefaultTipoIngresos: '01',
      taxId: '4-01-00755-1',
      name: 'Acme',
      legalName: 'Acme SRL',
      email: 'billing@acme.test',
      phone: '8095550101',
      address: 'Calle Principal 1',
      fiscalTradeName: null,
      fiscalBranch: 'Principal',
      fiscalEconomicActivity: 'Servicios',
      fiscalMunicipality: '010100',
      fiscalProvince: '01',
    },
    customer: {
      name: 'Cliente Uno',
      companyName: 'Cliente Uno SRL',
      taxId: '131298761',
      email: 'cliente@test.do',
      address: 'Calle Cliente 2',
      city: '010100',
    },
    invoice: {
      id: '00000000-0000-4000-8000-000000000001',
      issueDate: '2026-08-10',
      dueDate: '2026-09-10',
      currency: 'DOP',
      subtotal: '100.00',
      discountTotal: '0.00',
      taxTotal: '18.00',
      total: '118.00',
      amountPaid: '0.00',
      balanceDue: '118.00',
    },
    items: [
      {
        productName: 'Servicio profesional',
        description: 'Consultoría',
        quantity: '1.0000',
        unitPrice: '100.00',
        discountPct: '0.0000',
        taxRate: '0.1800',
        lineSubtotal: '100.00',
        lineTax: '18.00',
        lineTotal: '118.00',
        sortOrder: 0,
      },
    ],
  };
}

function expectMapperCode(inputs: FiscalInvoiceInputs, code: string) {
  try {
    buildInvoiceRequest(inputs);
    throw new Error('Expected mapper to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(FiscalMapperError);
    expect((error as FiscalMapperError).issues[0]?.code).toBe(code);
  }
}

describe('fiscal mapper helpers', () => {
  it('formats valid dates without timezone conversion', () => {
    expect(formatDateForDgii('2026-08-10')).toBe('10-08-2026');
    expect(() => formatDateForDgii('2026-02-30')).toThrow(FiscalMapperError);
  });

  it('maps supported rates and treats zero as exempt', () => {
    expect(mapTaxRateToIndicator('0.1800')).toBe(IndicadorFacturacion.Itbis18);
    expect(mapTaxRateToIndicator('0.1600')).toBe(IndicadorFacturacion.Itbis16);
    expect(mapTaxRateToIndicator('0')).toBe(IndicadorFacturacion.Exento);
    expect(() => mapTaxRateToIndicator('0.10')).toThrow(FiscalMapperError);
  });
});

describe('buildInvoiceRequest', () => {
  it('builds an E31 credit invoice with normalized IDs and net item amount', () => {
    const result = buildInvoiceRequest(validInputs());

    expect(result.documentType).toBe(DocumentType.E31);
    expect(result.operationMode).toBe('CLOUD');
    expect(result.integrationMode).toBe('JSON');
    expect(result.externalReference).toBe('00000000-0000-4000-8000-000000000001');
    expect(result.idDoc).toMatchObject({
      version: '1.0',
      tipoeCF: DocumentType.E31,
      tipoPago: TipoPago.Credito,
      fechaLimitePago: '10-09-2026',
      tipoIngresos: '01',
    });
    expect(result.idDoc).not.toHaveProperty('eNCF');
    expect(result.idDoc).not.toHaveProperty('fechaVencimientoSecuencia');
    expect(result.emisor.rncEmisor).toBe('401007551');
    expect(result.items[0]).toMatchObject({
      numeroLinea: 1,
      cantidadItem: '1.00',
      precioUnitarioItem: '100.0000',
      montoItem: '100.00',
    });
    expect(result.items[0]).not.toHaveProperty('descuentoMonto');
    expect(result.totales).toEqual({
      montoGravadoTotal: '100.00',
      montoGravadoI1: '100.00',
      itbis1: 18,
      totalITBIS1: '18.00',
      totalITBIS: '18.00',
      montoTotal: '118.00',
    });
  });

  it('builds an explicitly configured taxable E32', () => {
    const inputs = validInputs();
    inputs.business.fiscalDefaultDocumentType = 'E32';
    inputs.invoice.dueDate = null;
    const result = buildInvoiceRequest(inputs);

    expect(result.documentType).toBe(DocumentType.E32);
    expect(result.idDoc).toMatchObject({
      tipoPago: TipoPago.Contado,
      indicadorMontoGravado: 1,
    });
    expect(result.idDoc).not.toHaveProperty('fechaLimitePago');
  });

  it('falls back from E31 to E32 for a customer with a valid Cédula', () => {
    const inputs = validInputs();
    inputs.customer.taxId = '001-1456789-4';
    const result = buildInvoiceRequest(inputs);

    expect(result.documentType).toBe(DocumentType.E32);
    expect(result.comprador?.rncComprador).toBe('00114567894');
  });

  it('groups 18%, 16% and exempt lines correctly', () => {
    const inputs = validInputs();
    inputs.invoice = {
      ...inputs.invoice,
      subtotal: '350.00',
      taxTotal: '50.00',
      total: '400.00',
      balanceDue: '400.00',
    };
    inputs.items = [
      inputs.items[0]!,
      {
        ...inputs.items[0]!,
        productName: 'Servicio 16',
        quantity: '2.0000',
        taxRate: '0.1600',
        lineSubtotal: '200.00',
        lineTax: '32.00',
        lineTotal: '232.00',
        sortOrder: 4,
      },
      {
        ...inputs.items[0]!,
        productName: 'Servicio exento',
        unitPrice: '50.00',
        taxRate: '0.0000',
        lineSubtotal: '50.00',
        lineTax: '0.00',
        lineTotal: '50.00',
        sortOrder: 9,
      },
    ];
    const result = buildInvoiceRequest(inputs);

    expect(result.items.map((item) => item.numeroLinea)).toEqual([1, 2, 3]);
    expect(result.totales).toMatchObject({
      montoGravadoTotal: '300.00',
      montoGravadoI1: '100.00',
      montoGravadoI2: '200.00',
      montoExento: '50.00',
      totalITBIS1: '18.00',
      totalITBIS2: '32.00',
      totalITBIS: '50.00',
      montoTotal: '400.00',
    });
  });

  it('maps a line discount and keeps montoItem before tax', () => {
    const inputs = validInputs();
    inputs.invoice = {
      ...inputs.invoice,
      subtotal: '180.00',
      discountTotal: '20.00',
      taxTotal: '32.40',
      total: '212.40',
      balanceDue: '212.40',
    };
    inputs.items[0] = {
      ...inputs.items[0]!,
      quantity: '2.0000',
      discountPct: '0.1000',
      lineSubtotal: '180.00',
      lineTax: '32.40',
      lineTotal: '212.40',
    };
    const result = buildInvoiceRequest(inputs);

    expect(result.items[0]).toMatchObject({
      descuentoMonto: '20.00',
      montoItem: '180.00',
    });
  });

  it('includes advance payment and remaining value together', () => {
    const inputs = validInputs();
    inputs.invoice.amountPaid = '50.00';
    inputs.invoice.balanceDue = '68.00';
    const result = buildInvoiceRequest(inputs);

    expect(result.totales).toMatchObject({
      montoAvancePago: '50.00',
      valorPagar: '68.00',
    });
  });

  it('builds a fully exempt E32 without indicadorMontoGravado', () => {
    const inputs = validInputs();
    inputs.business.fiscalDefaultDocumentType = 'E32';
    inputs.invoice = {
      ...inputs.invoice,
      subtotal: '100.00',
      taxTotal: '0.00',
      total: '100.00',
      balanceDue: '100.00',
    };
    inputs.items[0] = {
      ...inputs.items[0]!,
      taxRate: '0.0000',
      lineTax: '0.00',
      lineTotal: '100.00',
    };
    const result = buildInvoiceRequest(inputs);

    expect(result.idDoc).not.toHaveProperty('indicadorMontoGravado');
    expect(result.totales).toEqual({
      montoExento: '100.00',
      montoTotal: '100.00',
    });
  });

  it.each([
    ['FISCAL_NOT_ENABLED', (v: FiscalInvoiceInputs) => { v.business.fiscalEnabled = false; }],
    ['FISCAL_BUSINESS_TAX_ID_INVALID', (v: FiscalInvoiceInputs) => { v.business.taxId = '123'; }],
    ['FISCAL_REQUIRED_FIELD', (v: FiscalInvoiceInputs) => { v.business.address = null; }],
    ['FISCAL_CUSTOMER_TAX_ID_INVALID', (v: FiscalInvoiceInputs) => { v.customer.taxId = null; }],
    ['FISCAL_UNSUPPORTED_CURRENCY', (v: FiscalInvoiceInputs) => { v.invoice.currency = 'USD'; }],
    ['FISCAL_ITEMS_REQUIRED', (v: FiscalInvoiceInputs) => { v.items = []; }],
    ['FISCAL_QUANTITY_PRECISION_UNSUPPORTED', (v: FiscalInvoiceInputs) => { v.items[0]!.quantity = '1.2340'; }],
    ['FISCAL_UNSUPPORTED_TAX_RATE', (v: FiscalInvoiceInputs) => { v.items[0]!.taxRate = '0.1000'; }],
    ['FISCAL_TOTALS_MISMATCH', (v: FiscalInvoiceInputs) => { v.invoice.total = '999.00'; }],
    ['FISCAL_PAYMENT_TOTALS_MISMATCH', (v: FiscalInvoiceInputs) => { v.invoice.balanceDue = '100.00'; }],
  ])('rejects invalid fiscal data with %s', (code, mutate) => {
    const inputs = validInputs();
    mutate(inputs);
    expectMapperCode(inputs, code);
  });
});
