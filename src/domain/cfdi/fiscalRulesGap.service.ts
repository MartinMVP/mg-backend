import { FacturamaInvoiceDraftRequest } from '../fiscalProviders/facturamaInvoice.types';
import { FiscalOperationType } from './fiscalOperation.types';

export type FiscalRulesGapResult = {
  requiresFiscalReview: boolean;
  blockers: string[];
  warnings: string[];
};

type FiscalRulesGapInput = {
  draft: FacturamaInvoiceDraftRequest;
  operationType?: FiscalOperationType;
};

const serviceOperationTypes: FiscalOperationType[] = [
  'platform_commission',
  'auction_service',
  'premium_listing',
  'administrative_service',
];

function getPersonTypeFromRfc(rfc?: string) {
  const normalized = (rfc || '').trim();
  if (normalized.length === 13) return 'physical_person';
  if (normalized.length === 12) return 'legal_entity';
  return 'unknown';
}

export function analyzeFiscalRulesGap(input: FiscalRulesGapInput): FiscalRulesGapResult {
  const operationType = input.operationType || 'cattle_sale';
  const issuerType = getPersonTypeFromRfc(input.draft.issuer?.rfc);
  const receiverType = getPersonTypeFromRfc(input.draft.receiver?.rfc);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (issuerType === 'physical_person' && receiverType === 'legal_entity') {
    blockers.push('pf_to_pm_requires_fiscal_review');
    blockers.push('possible_isr_withholding_requires_review');
    blockers.push('possible_iva_withholding_requires_review');
  }

  if (issuerType === 'legal_entity' && receiverType === 'physical_person') {
    blockers.push('pm_to_pf_requires_fiscal_review');
  }

  if (serviceOperationTypes.includes(operationType)) {
    blockers.push('service_or_commission_requires_fiscal_review');
  }

  if (operationType === 'platform_commission') {
    blockers.push('commission_requires_fiscal_review');
  }

  if (input.draft.concepts.some((concept) => concept.taxObject)) {
    blockers.push('formal_tax_calculation_missing');
    warnings.push('tax_object_defined_without_formal_tax_engine');
  }

  if (input.draft.concepts.some((concept) => concept.taxObject === '02')) {
    blockers.push('transferred_iva_requires_review');
  }

  warnings.push('issuer_regime_rules_not_evaluated');
  warnings.push('receiver_regime_rules_not_evaluated');
  warnings.push('operation_type_rules_not_finalized');

  return {
    requiresFiscalReview: blockers.length > 0,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
  };
}
