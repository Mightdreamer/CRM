import { describe, expect, it } from 'vitest';
import {
  detectTaxIdKind,
  isValidCedula,
  isValidRNC,
  isValidTaxId,
} from './rnc';

describe('isValidRNC', () => {
  it('accepts known valid RNCs', () => {
    expect(isValidRNC('401007551')).toBe(true); // DGII (real-world sample)
    expect(isValidRNC('131298761')).toBe(true);
    expect(isValidRNC('130300003')).toBe(true);
  });

  it('accepts formatted RNCs (dashes/spaces stripped)', () => {
    expect(isValidRNC('4-01-00755-1')).toBe(true);
    expect(isValidRNC('401 007 551')).toBe(true);
  });

  it('rejects invalid check digits', () => {
    expect(isValidRNC('401007552')).toBe(false);
    expect(isValidRNC('131298762')).toBe(false);
    expect(isValidRNC('131456789')).toBe(false); // plan payload example — not a real RNC
  });

  it('rejects wrong length', () => {
    expect(isValidRNC('12345678')).toBe(false);
    expect(isValidRNC('1234567890')).toBe(false);
    expect(isValidRNC('')).toBe(false);
  });

  it('rejects non-numeric', () => {
    expect(isValidRNC('abcdefghi')).toBe(false);
    expect(isValidRNC('40100755a')).toBe(false);
  });
});

describe('isValidCedula', () => {
  it('accepts a computed valid cédula', () => {
    // Digits 0011456789 → check 4 (see algorithm doc)
    expect(isValidCedula('00114567894')).toBe(true);
  });

  it('accepts formatted cédulas', () => {
    expect(isValidCedula('001-1456789-4')).toBe(true);
  });

  it('rejects invalid check digits', () => {
    expect(isValidCedula('00114567890')).toBe(false);
    expect(isValidCedula('00114567895')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isValidCedula('1234567890')).toBe(false); // 10 digits
    expect(isValidCedula('123456789012')).toBe(false); // 12 digits
  });
});

describe('isValidTaxId', () => {
  it('accepts either format when checksum is valid', () => {
    expect(isValidTaxId('401007551')).toBe(true); // RNC
    expect(isValidTaxId('00114567894')).toBe(true); // Cédula
  });

  it('rejects lengths that do not match either format', () => {
    expect(isValidTaxId('1234567890')).toBe(false);
  });
});

describe('detectTaxIdKind', () => {
  it('returns RNC / CEDULA for valid inputs', () => {
    expect(detectTaxIdKind('401007551')).toBe('RNC');
    expect(detectTaxIdKind('00114567894')).toBe('CEDULA');
  });

  it('returns null for invalid input', () => {
    expect(detectTaxIdKind('401007552')).toBeNull();
    expect(detectTaxIdKind('')).toBeNull();
  });
});
