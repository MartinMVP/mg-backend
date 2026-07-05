import { AOEDecisionConfidence, AOEDecisionContext, AOEDecisionRiskLevel } from './aoeDecision.types';

export function calculateDecisionRisk(context: AOEDecisionContext, confidence: AOEDecisionConfidence): AOEDecisionRiskLevel {
  const summaries = context.evidence.map((item) => String(item.summary || '').toLowerCase()).join(' ');
  if (context.aoeCase.priority === 'critical' || summaries.includes('fraud')) return 'critical';
  if (summaries.includes('contradictory') || context.qualitySummary.recommendedMode === 'blocked') return 'high';
  if (context.qualitySummary.recommendedMode === 'audit_fallback' || confidence.overall < 70) return 'medium';
  return 'low';
}

export function getMissingEvidence(context: AOEDecisionContext) {
  const summaries = context.evidence.map((item) => String(item.summary || '').toLowerCase()).join(' ');
  const missing = [];
  if (!summaries.includes('seller')) missing.push('seller_response');
  if (!summaries.includes('buyer')) missing.push('buyer_response');
  if (context.evidence.length < 2) missing.push('documentary_evidence');
  if (context.auditSummary.totalEvents === 0) missing.push('admin_confirmation');
  if (context.aoeCase.type === 'revenue_signal') missing.push('payment_validation');
  return [...new Set(missing)];
}

export function getRequiredHumanSkills(context: AOEDecisionContext) {
  const skills = ['operations'];
  if (context.aoeCase.type.includes('auction') || context.aoeCase.entityType === 'auction') skills.push('auctions');
  if (context.aoeCase.type.includes('appeal')) skills.push('compliance');
  if (context.aoeCase.type.includes('membership')) skills.push('membership');
  if (context.aoeCase.type.includes('revenue')) skills.push('revenue');
  if (context.aoeCase.type.includes('messaging')) skills.push('marketplace');
  return [...new Set(skills)];
}

export function getAlternativeActions(context: AOEDecisionContext) {
  const actions = ['no_action', 'warning', 'escalate', 'request_more_evidence'];
  if (context.aoeCase.type === 'auction_default' || context.aoeCase.type === 'sanction_review') {
    actions.push('suggest_sanction');
  }
  if (context.aoeCase.type === 'appeal_review') {
    actions.push('suggest_appeal_approval', 'suggest_appeal_rejection');
  }
  return [...new Set(actions)];
}
