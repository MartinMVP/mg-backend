import { AOECasePriority } from './aoeCase.model';
import { AOEClassification } from './aoeClassification.service';
import { IAOEEvidence } from './aoeEvidence.model';

export function shouldEscalateToAdmin(input: {
  classification: AOEClassification | 'third_offense';
  priority?: AOECasePriority;
  evidence?: Array<Partial<IAOEEvidence>>;
}) {
  if (input.priority === 'critical') return true;
  if (['possible_fraud', 'appeal_request', 'third_offense', 'high_value_conflict'].includes(input.classification)) {
    return true;
  }
  const summaries = (input.evidence || []).map((item) => String(item.summary || '').toLowerCase());
  return summaries.some((summary) => summary.includes('contradictory evidence'));
}
