import { FacturamaDraftValidationResult, FacturamaInvoiceDraftRequest } from './facturamaInvoice.types';

const forbiddenArtifactPattern = /(xml|pdf|uuid|sello|certificado|cadena|timbre)/i;
const basicRfcPattern = /^[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}$/i;
const postalCodePattern = /^\d{5}$/;

function isPositiveFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function hasForbiddenFiscalArtifact(value: unknown): boolean {
  if (typeof value === 'string') return forbiddenArtifactPattern.test(value);
  if (!value || typeof value !== 'object') return false;

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenArtifactPattern.test(key)) return true;
    if (hasForbiddenFiscalArtifact(nestedValue)) return true;
  }

  return false;
}

export function validateFacturamaDraft(
  draft: FacturamaInvoiceDraftRequest
): FacturamaDraftValidationResult {
  const issues: string[] = [];

  if (!draft.issuer) issues.push('missing_issuer');
  if (!draft.receiver) issues.push('missing_receiver');
  if (!Array.isArray(draft.concepts) || draft.concepts.length === 0) issues.push('missing_concepts');

  if (draft.issuer) {
    if (!draft.issuer.rfc) issues.push('missing_issuer_rfc');
    else if (!basicRfcPattern.test(draft.issuer.rfc)) issues.push('invalid_issuer_rfc');
    if (!draft.issuer.name) issues.push('missing_issuer_name');
    if (!draft.issuer.fiscalRegime) issues.push('missing_issuer_fiscal_regime');
    if (!draft.issuer.postalCode) issues.push('missing_issuer_postal_code');
    else if (!postalCodePattern.test(draft.issuer.postalCode)) issues.push('invalid_issuer_postal_code');
  }

  if (draft.receiver) {
    if (!draft.receiver.rfc) issues.push('missing_receiver_rfc');
    else if (!basicRfcPattern.test(draft.receiver.rfc)) issues.push('invalid_receiver_rfc');
    if (!draft.receiver.name) issues.push('missing_receiver_name');
    if (!draft.receiver.fiscalRegime) issues.push('missing_receiver_fiscal_regime');
    if (!draft.receiver.postalCode) issues.push('missing_receiver_postal_code');
    else if (!postalCodePattern.test(draft.receiver.postalCode)) issues.push('invalid_receiver_postal_code');
    if (!draft.receiver.cfdiUse) issues.push('missing_cfdi_use');
  }

  if (draft.totals.currency !== 'MXN') issues.push('invalid_currency');
  if (!isPositiveFiniteNumber(draft.totals.subtotal)) issues.push('invalid_subtotal');
  if (typeof draft.totals.taxes !== 'number' || !Number.isFinite(draft.totals.taxes) || draft.totals.taxes < 0) {
    issues.push('invalid_taxes');
  }
  if (!isPositiveFiniteNumber(draft.totals.total)) issues.push('invalid_total');
  if (draft.totals.total < draft.totals.subtotal) issues.push('invalid_total');

  for (const concept of draft.concepts || []) {
    if (!concept.productCode) issues.push('missing_product_code');
    if (!concept.unitCode) issues.push('missing_unit_code');
    if (!concept.description) issues.push('missing_concept_description');
    if (!isPositiveFiniteNumber(concept.quantity)) issues.push('invalid_concept_quantity');
    if (!isPositiveFiniteNumber(concept.unitPrice)) issues.push('invalid_concept_unit_price');
    if (!isPositiveFiniteNumber(concept.amount)) issues.push('invalid_concept_amount');
    if (!concept.taxObject) issues.push('missing_tax_object');
  }

  if (!draft.expeditionPlace) issues.push('missing_expedition_place');
  else if (!postalCodePattern.test(draft.expeditionPlace)) issues.push('invalid_expedition_place');

  if (hasForbiddenFiscalArtifact(draft)) issues.push('forbidden_fiscal_artifact');

  return {
    valid: issues.length === 0,
    issues,
  };
}
