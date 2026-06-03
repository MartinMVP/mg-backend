import { FacturamaInvoiceDraftRequest } from './facturamaInvoice.types';

export type FacturamaContractComplianceResult = {
  status: 'ready' | 'warning' | 'blocked';
  issues: string[];
  warnings: string[];
};

const forbiddenArtifactPattern = /(xml|pdf|uuid|sello|certificado|cadena|timbre)/i;

function hasForbiddenFiscalArtifact(value: unknown): boolean {
  if (typeof value === 'string') return forbiddenArtifactPattern.test(value);
  if (!value || typeof value !== 'object') return false;

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenArtifactPattern.test(key)) return true;
    if (hasForbiddenFiscalArtifact(nestedValue)) return true;
  }

  return false;
}

export function checkFacturamaContractCompliance(
  draft: FacturamaInvoiceDraftRequest
): FacturamaContractComplianceResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!draft.receiver) issues.push('receiver_missing');
  if (!Array.isArray(draft.concepts) || draft.concepts.length === 0) issues.push('concepts_missing');
  if (!draft.totals) issues.push('totals_missing');
  if (!draft.metadata || draft.metadata.compatibility !== 'facturama_draft_preview_only') {
    issues.push('incompatible_draft_metadata');
  }

  if (draft.receiver) {
    if (!draft.receiver.cfdiUse) issues.push('cfdi_use_missing');
    if (!draft.receiver.fiscalRegime) issues.push('receiver_fiscal_regime_missing');
    if (!draft.receiver.rfc) issues.push('receiver_rfc_missing');
    if (!draft.receiver.name) issues.push('receiver_name_missing');
    if (!draft.receiver.postalCode) issues.push('receiver_postal_code_missing');
  }

  if (draft.issuer) {
    if (!draft.issuer.fiscalRegime) issues.push('issuer_fiscal_regime_missing');
    if (!draft.issuer.rfc) issues.push('issuer_rfc_missing');
    if (!draft.issuer.name) issues.push('issuer_name_missing');
    if (!draft.issuer.postalCode) issues.push('issuer_postal_code_missing');
  } else {
    issues.push('issuer_missing');
  }

  if (draft.totals) {
    if (draft.totals.currency !== 'MXN') issues.push('currency_not_supported');
    if (typeof draft.totals.total !== 'number' || draft.totals.total <= 0) issues.push('total_invalid');
    if (typeof draft.totals.subtotal !== 'number' || draft.totals.subtotal <= 0) issues.push('subtotal_invalid');
  }

  for (const concept of draft.concepts || []) {
    if (!concept.productCode) issues.push('product_service_key_missing');
    if (!concept.unitCode) issues.push('unit_key_missing');
    if (!concept.taxObject) issues.push('tax_object_missing');
    if (!concept.description) issues.push('concept_description_missing');
    if (typeof concept.quantity !== 'number' || concept.quantity <= 0) issues.push('concept_quantity_invalid');
    if (typeof concept.amount !== 'number' || concept.amount <= 0) issues.push('concept_amount_invalid');
  }

  warnings.push('payment_form_pending_definition');
  warnings.push('payment_method_pending_definition');
  warnings.push('formal_tax_breakdown_pending');

  if (draft.concepts?.some((concept) => concept.taxObject && draft.totals.taxes === 0)) {
    warnings.push('taxes_explicitly_pending');
  }

  if (hasForbiddenFiscalArtifact(draft)) {
    issues.push('forbidden_fiscal_artifact');
  }

  return {
    status: issues.length > 0 ? 'blocked' : warnings.length > 0 ? 'warning' : 'ready',
    issues: [...new Set(issues)],
    warnings: [...new Set(warnings)],
  };
}
