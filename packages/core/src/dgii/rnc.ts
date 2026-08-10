// DGII (Dirección General de Impuestos Internos, Dominican Republic)
// tax identifier validation.
//
//  * RNC (Registro Nacional del Contribuyente) — 9 digits, mod-11 checksum.
//  * Cédula — 11 digits, Luhn-style checksum.
//
// Both algorithms are documented publicly by DGII and used by e-CF issuers
// and government portals.

const RNC_WEIGHTS = [7, 9, 8, 6, 5, 4, 3, 2] as const;
const CEDULA_WEIGHTS = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2] as const;

function stripNonDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export function isValidRNC(value: string): boolean {
  const digits = stripNonDigits(value);
  if (!/^\d{9}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 8; i++) {
    sum += Number(digits.charAt(i)) * RNC_WEIGHTS[i]!;
  }

  const remainder = sum % 11;
  let check: number;
  if (remainder === 0) check = 2;
  else if (remainder === 1) check = 1;
  else check = 11 - remainder;

  return check === Number(digits.charAt(8));
}

export function isValidCedula(value: string): boolean {
  const digits = stripNonDigits(value);
  if (!/^\d{11}$/.test(digits)) return false;

  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let product = Number(digits.charAt(i)) * CEDULA_WEIGHTS[i]!;
    if (product > 9) product = Math.floor(product / 10) + (product % 10);
    sum += product;
  }

  const check = (10 - (sum % 10)) % 10;
  return check === Number(digits.charAt(10));
}

// Accepts either format. Useful for customer.tax_id which can be a
// business RNC or a person's Cédula.
export function isValidTaxId(value: string): boolean {
  const digits = stripNonDigits(value);
  if (digits.length === 9) return isValidRNC(digits);
  if (digits.length === 11) return isValidCedula(digits);
  return false;
}

export type TaxIdKind = 'RNC' | 'CEDULA';

export function detectTaxIdKind(value: string): TaxIdKind | null {
  const digits = stripNonDigits(value);
  if (digits.length === 9 && isValidRNC(digits)) return 'RNC';
  if (digits.length === 11 && isValidCedula(digits)) return 'CEDULA';
  return null;
}
