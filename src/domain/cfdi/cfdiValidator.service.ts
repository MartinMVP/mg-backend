import { CfdiRequest, CfdiValidationResult } from './cfdi.types';

const RFC_PATTERN = /^[A-Z0-9]{12,13}$/;
const POSTAL_CODE_PATTERN = /^\d{5}$/;

function isPositiveFiniteAmount(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
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
  if (!request.receiver.regimenFiscal) {
    issues.push('receiver_regimen_fiscal_missing');
  }
  if (!request.receiver.usoCFDI) {
    issues.push('receiver_uso_cfdi_missing');
  }
  if (request.currency !== 'MXN' || request.totals.currency !== 'MXN') {
    issues.push('currency_invalid');
  }
  if (!request.concepts.length) {
    issues.push('concepts_missing');
  }

  for (const [index, concept] of request.concepts.entries()) {
    if (!isPositiveFiniteAmount(concept.quantity)) {
      issues.push(`concept_${index}_quantity_invalid`);
    }
    if (!isPositiveFiniteAmount(concept.unitPrice)) {
      issues.push(`concept_${index}_unit_price_invalid`);
    }
    if (!isPositiveFiniteAmount(concept.amount)) {
      issues.push(`concept_${index}_amount_invalid`);
    }
  }

  if (!isPositiveFiniteAmount(request.totals.total)) {
    issues.push('total_invalid');
  }
  if (!isPositiveFiniteAmount(request.totals.subtotal)) {
    issues.push('subtotal_invalid');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
