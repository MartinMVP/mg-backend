import { AOEDecisionContext } from './aoeDecision.types';

export function buildDecisionNarrative(input: {
  context: AOEDecisionContext;
  appliedRules: string[];
  riskLevel: string;
  alternativeActions: string[];
  missingEvidence: string[];
  recommendedAction: string;
}) {
  return {
    whatHappened: `AOE case ${input.context.aoeCase.type} was prepared for human operational review.`,
    evidenceAvailable: `${input.context.evidence.length} evidence item(s), ${input.context.auditSummary.totalEvents} audit event(s), ${input.context.analyticsSummary.totalEvents} analytics event(s).`,
    rulesApplied: input.appliedRules,
    risks: [input.riskLevel],
    alternatives: input.alternativeActions,
    missingInformation: input.missingEvidence,
    recommendation: input.recommendedAction,
    note: 'Deterministic narrative generated without autonomous execution.',
  };
}
