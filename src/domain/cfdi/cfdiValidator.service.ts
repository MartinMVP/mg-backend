import { CfdiRequest, CfdiValidationResult } from './cfdi.types';
import {
  INTERNAL_CFDI_ALLOWED_CURRENCIES,
  INTERNAL_CFDI_ALLOWED_REGIMENES,
  INTERNAL_CFDI_ALLOWED_TAX_OBJECTS,
  INTERNAL_CFDI_ALLOWED_USOS,
} from './cfdiCatalogs';

const RFC_PATTERN = /^[A-Z0-9]{12,13}$/;
const POSTAL_CODE_PATTERN = /^\d{5}$/;
const AMOUNT_TOLERANCE = 0.01;

function isPositiveFiniteAmount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isFiniteAmount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value);
}

function amountsMatch(left: number, right: number) {
  return Math.abs(left - right) <= AMOUNT_TOLERANCE;
}

export function validateCfdiRequest(request: CfdiRequest): CfdiValidationResult {
  const issues: string[] = [];

  if (!request.issuer.rfc || !RFC_PATTERN.test(request.issuer.rfc)) {
    issues.push('issuer_rfc_invalid');
  }
  if (!request.receiver.rfc || !RFC_PATTERN.test(request.receiver.rfc)) {
    issues.push('receiver_rfc_invalid');
  }
  if (!request.issuer.name) {
    issues.push('issuer_name_missing');
  }
  if (!request.receiver.name) {
    issues.push('receiver_name_missing');
  }
  if (!request.issuer.postalCode || !POSTAL_CODE_PATTERN.test(request.issuer.postalCode)) {
    issues.push('issuer_postal_code_invalid');
  }
  if (!request.receiver.postalCode || !POSTAL_CODE_PATTERN.test(request.receiver.postalCode)) {
    issues.push('receiver_postal_code_invalid');
  }
  if (!request.issuer.regimenFiscal) {
    issues.push('issuer_regimen_fiscal_missing');
  }
  if (request.issuer.regimenFiscal && !INTERNAL_CFDI_ALLOWED_REGIMENES.includes(request.issuer.regimenFiscal as any)) {
    issues.push('invalid_issuer_regimen');
  }
  if (!request.receiver.regimenFiscal) {
    issues.push('receiver_regimen_fiscal_missing');
  }
  if (request.receiver.regimenFiscal && !INTERNAL_CFDI_ALLOWED_REGIMENES.includes(request.receiver.regimenFiscal as any)) {
    issues.push('invalid_receiver_regimen');
  }
  if (!request.receiver.usoCFDI) {
    issues.push('receiver_uso_cfdi_missing');
  }
  if (request.receiver.usoCFDI && !INTERNAL_CFDI_ALLOWED_USOS.includes(request.receiver.usoCFDI as any)) {
    issues.push('invalid_uso_cfdi');
  }
  if (
    !INTERNAL_CFDI_ALLOWED_CURRENCIES.includes(request.currency as any)
    || !INTERNAL_CFDI_ALLOWED_CURRENCIES.includes(request.totals.currency as any)
  ) {
    issues.push('currency_invalid');
    issues.push('invalid_currency');
  }
  if (!request.concepts.length) {
    issues.push('concepts_missing');
  }
  if (request.issuer.rfc && request.receiver.rfc && request.issuer.rfc === request.receiver.rfc) {
    issues.push('same_issuer_receiver_rfc');
  }

  let conceptSubtotal = 0;
  for (const [index, concept] of request.concepts.entries()) {
    if (!concept.productServiceKey) {
      issues.push('missing_product_service_key');
    }
    if (!concept.unitKey) {
      issues.push('missing_unit_key');
    }
    if (!INTERNAL_CFDI_ALLOWED_TAX_OBJECTS.includes(concept.taxObject as any)) {
      issues.push('invalid_tax_object');
    }
    if (!isPositiveFiniteAmount(concept.quantity)) {
      issues.push(`concept_${index}_quantity_invalid`);
    }
    if (!isPositiveFiniteAmount(concept.unitPrice)) {
      issues.push(`concept_${index}_unit_price_invalid`);
    }
    if (!isPositiveFiniteAmount(concept.amount)) {
      issues.push(`concept_${index}_amount_invalid`);
    }
    if (
      isPositiveFiniteAmount(concept.quantity)
      && isPositiveFiniteAmount(concept.unitPrice)
      && isPositiveFiniteAmount(concept.amount)
      && !amountsMatch(concept.amount, concept.quantity * concept.unitPrice)
    ) {
      issues.push('invalid_concept_amount');
    }
    if (isPositiveFiniteAmount(concept.amount)) {
      conceptSubtotal += concept.amount;
    }
  }

  if (!isPositiveFiniteAmount(request.totals.total)) {
    issues.push('total_invalid');
  }
  if (!isPositiveFiniteAmount(request.totals.subtotal)) {
    issues.push('subtotal_invalid');
  }
  if (
    isPositiveFiniteAmount(request.totals.subtotal)
    && request.concepts.length > 0
    && !amountsMatch(request.totals.subtotal, conceptSubtotal)
  ) {
    issues.push('invalid_subtotal');
  }
  if (
    isPositiveFiniteAmount(request.totals.total)
    && isPositiveFiniteAmount(request.totals.subtotal)
    && request.totals.total < request.totals.subtotal
  ) {
    issues.push('invalid_total');
  }
  if (!isFiniteAmount(request.totals.taxes) || request.totals.taxes < 0) {
    issues.push('invalid_taxes');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
