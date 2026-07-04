import { IAOECase } from './aoeCase.model';
import { IAOEEvidence } from './aoeEvidence.model';

export const aoeClassifications = [
  'simple_default',
  'repeat_default',
  'seller_abandonment',
  'buyer_abandonment',
  'appeal_request',
  'possible_fraud',
  'high_value_conflict',
  'membership_signal',
  'revenue_signal',
  'messaging_signal',
  'marketplace_signal',
] as const;
export type AOEClassification = typeof aoeClassifications[number];

function evidenceText(evidence: Array<Partial<IAOEEvidence>>) {
  return evidence.map((item) => `${item.summary || ''} ${JSON.stringify(item.metadata || {})}`).join(' ').toLowerCase();
}

export function classifyAOECase(
  aoeCase: Pick<IAOECase, 'type' | 'priority'>,
  evidence: Array<Partial<IAOEEvidence>> = []
): AOEClassification {
  const text = evidenceText(evidence);
  if (aoeCase.type === 'fraud_signal' || text.includes('fraud')) return 'possible_fraud';
  if (aoeCase.priority === 'critical' || text.includes('high_value')) return 'high_value_conflict';
  if (aoeCase.type === 'appeal_review') return 'appeal_request';
  if (aoeCase.type === 'membership_signal') return 'membership_signal';
  if (aoeCase.type === 'revenue_signal') return 'revenue_signal';
  if (aoeCase.type === 'messaging_signal') return 'messaging_signal';
  if (aoeCase.type === 'marketplace_signal') return 'marketplace_signal';
  if (text.includes('seller') && text.includes('default')) return 'seller_abandonment';
  if (text.includes('buyer') && text.includes('default')) return 'buyer_abandonment';
  if (text.includes('offense') && !text.includes('offensenumber\":1')) return 'repeat_default';
  return 'simple_default';
}
