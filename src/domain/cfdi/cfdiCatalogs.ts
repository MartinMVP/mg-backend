// Catalogos internos provisionales para validaciones de negocio CFDI.
// NO son catalogos oficiales del SAT y NO deben usarse como sustituto de validacion SAT real.
export const INTERNAL_CFDI_ALLOWED_REGIMENES = [
  '601',
  '603',
  '605',
  '606',
  '612',
  '616',
  '621',
  '626',
] as const;

export const INTERNAL_CFDI_ALLOWED_USOS = [
  'G01',
  'G03',
  'D01',
  'P01',
] as const;

export const INTERNAL_CFDI_ALLOWED_CURRENCIES = ['MXN'] as const;

export const INTERNAL_CFDI_ALLOWED_TAX_OBJECTS = [
  '01',
  '02',
  '03',
] as const;

export const INTERNAL_CFDI_DEFAULT_PRODUCT_SERVICE_KEY = '10101500';
export const INTERNAL_CFDI_DEFAULT_UNIT_KEY = 'E48';

export const INTERNAL_CFDI_ALLOWED_PRODUCT_SERVICE_KEYS = [
  INTERNAL_CFDI_DEFAULT_PRODUCT_SERVICE_KEY,
] as const;

export const INTERNAL_CFDI_ALLOWED_UNIT_KEYS = [
  INTERNAL_CFDI_DEFAULT_UNIT_KEY,
] as const;
