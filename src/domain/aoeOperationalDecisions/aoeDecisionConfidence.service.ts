import { AOEDecisionConfidence, AOEDecisionContext, AOEDecisionUncertainty } from './aoeDecision.types';

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function calculateAOEDecisionConfidence(context: AOEDecisionContext): AOEDecisionConfidence {
  const evidence = context.evidence.length > 0
    ? clamp(context.evidence.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / context.evidence.length)
    : 35;
  const analytics = context.qualitySummary.passed
    ? 90
    : context.qualitySummary.recommendedMode === 'audit_fallback'
      ? 60
      : context.qualitySummary.recommendedMode === 'blocked'
        ? 40
        : 70;
  const historical = clamp(Math.min(100, context.auditSummary.totalEvents * 10 + context.analyticsSummary.totalEvents * 12));
  const consistency = context.evidence.some((item) => String(item.summary || '').toLowerCase().includes('contradictory'))
    ? 45
    : context.evidence.length > 0 && context.analyticsSummary.totalEvents > 0
      ? 85
      : 65;
  const overall = clamp(evidence * 0.35 + analytics * 0.3 + historical * 0.15 + consistency * 0.2);
  return { overall, evidence, analytics, historical, consistency };
}

export function calculateDecisionUncertainty(confidence: AOEDecisionConfidence): AOEDecisionUncertainty {
  if (confidence.overall >= 85 && confidence.consistency >= 75) return 'low';
  if (confidence.overall >= 65) return 'medium';
  return 'high';
}
