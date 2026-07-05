import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { recordAnalyticsEvent } from '../analytics/analytics.service';
import { toObjectId } from '../aoe/aoeEvidence.service';
import { buildAOEDecisionContext } from './aoeDecisionContext.service';
import {
  calculateAOEDecisionConfidence,
  calculateDecisionUncertainty,
} from './aoeDecisionConfidence.service';
import { buildDecisionNarrative } from './aoeDecisionNarrative.service';
import {
  calculateDecisionRisk,
  getAlternativeActions,
  getMissingEvidence,
  getRequiredHumanSkills,
} from './aoeDecisionRisk.service';
import {
  AOEOperationalDecisionInput,
  AOEOperationalDecisionStatus,
  AOEOperationalDecisionType,
} from './aoeDecision.types';
import {
  countAOEOperationalDecisionPackages,
  createAOEOperationalDecisionPackage,
  findAOEOperationalDecisionPackageById,
  findLatestAOEOperationalDecisionForCase,
  listAOEOperationalDecisionPackages,
  setAOEOperationalDecisionStatus,
} from './aoeOperationalDecision.repository';

export const aoeOperationalDecisionAuditActions = {
  created: 'AOE_OPERATIONAL_DECISION_CREATED',
  viewed: 'AOE_OPERATIONAL_DECISION_VIEWED',
  escalated: 'AOE_OPERATIONAL_DECISION_ESCALATED',
  closed: 'AOE_OPERATIONAL_DECISION_CLOSED',
  degradedMode: 'AOE_OPERATIONAL_DECISION_DEGRADED_MODE',
} as const;

const defaultLimit = 50;
const maxLimit = 100;

function reject(status: number, message: string): never {
  const error = new Error(message);
  (error as any).status = status;
  throw error;
}

function normalizePagination(input: { page?: unknown; limit?: unknown } = {}) {
  const parsedPage = Number(input.page);
  const parsedLimit = Number(input.limit);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;
  const limit = Number.isFinite(parsedLimit) && parsedLimit >= 1
    ? Math.min(Math.floor(parsedLimit), maxLimit)
    : defaultLimit;
  return { page, limit, skip: (page - 1) * limit };
}

async function audit(actor: string, action: string, payload: Record<string, unknown>) {
  await Audit.create({ actor, action, payload });
}

function decisionTypeForCase(type: string): AOEOperationalDecisionType {
  const map: Record<string, AOEOperationalDecisionType> = {
    auction_default: 'default_review',
    sanction_review: 'sanction_review',
    appeal_review: 'appeal_review',
    fraud_signal: 'fraud_signal',
    operational_alert: 'operational_alert',
    membership_signal: 'membership_signal',
    revenue_signal: 'revenue_signal',
    messaging_signal: 'messaging_signal',
    marketplace_signal: 'marketplace_signal',
  };
  return map[type] || 'operational_alert';
}

function buildFacts(context: Awaited<ReturnType<typeof buildAOEDecisionContext>>) {
  return {
    evidenceItems: context.evidence.length,
    auditEvents: context.auditSummary.totalEvents,
    analyticsEvents: context.analyticsSummary.totalEvents,
    correlationIds: context.analyticsSummary.correlationIds.length,
    proposalAvailable: Boolean(context.proposal),
    degradedMode: context.qualitySummary.recommendedMode !== 'normal',
  };
}

function buildInterpretation(input: {
  context: Awaited<ReturnType<typeof buildAOEDecisionContext>>;
  riskLevel: string;
  confidenceOverall: number;
}) {
  return {
    recurrenceRisk: input.riskLevel === 'critical' || input.riskLevel === 'high' ? 'high' : 'medium',
    escalationRecommended: input.riskLevel === 'critical' || input.riskLevel === 'high',
    auditFallbackRecommended: input.context.qualitySummary.recommendedMode === 'audit_fallback',
    degradedMode: input.context.qualitySummary.recommendedMode !== 'normal',
    confidenceBand: input.confidenceOverall >= 85 ? 'high' : input.confidenceOverall >= 65 ? 'medium' : 'low',
  };
}

function buildAppliedRules(context: Awaited<ReturnType<typeof buildAOEDecisionContext>>) {
  const rules = ['GCD-0', 'GCD-9', context.platformConfiguration.decisionEngineVersion];
  if (context.aoeCase.type === 'auction_default' || context.aoeCase.type === 'sanction_review') {
    rules.push('GCD-3A.1', 'auction.sanctions.thirdOffensePolicy');
  }
  if (context.aoeCase.type === 'appeal_review') rules.push('GCD-3A.1', 'auction.sanctions.allowAppeals');
  if (context.qualitySummary.recommendedMode !== 'normal') rules.push('analytics.quality.auditFallback');
  return [...new Set(rules)];
}

function recommendedActionFor(context: Awaited<ReturnType<typeof buildAOEDecisionContext>>, riskLevel: string) {
  if (context.qualitySummary.recommendedMode === 'audit_fallback') return 'request_more_evidence';
  if (riskLevel === 'critical' || riskLevel === 'high') return 'escalate';
  if (context.proposal?.proposalType) return String(context.proposal.proposalType);
  return 'warning';
}

export async function generateAOEOperationalDecisionPackage(input: AOEOperationalDecisionInput) {
  const context = await buildAOEDecisionContext(input);
  const confidence = calculateAOEDecisionConfidence(context);
  const uncertainty = calculateDecisionUncertainty(confidence);
  const riskLevel = calculateDecisionRisk(context, confidence);
  const missingEvidence = getMissingEvidence(context);
  const requiredHumanSkills = getRequiredHumanSkills(context);
  const alternativeActions = getAlternativeActions(context);
  const appliedRules = buildAppliedRules(context);
  const recommendedAction = recommendedActionFor(context, riskLevel);
  const generatedAt = new Date();
  const expiresAt = new Date(generatedAt.getTime() + context.platformConfiguration.expirationDays * 24 * 60 * 60_000);
  const facts = buildFacts(context);
  const interpretation = buildInterpretation({ context, riskLevel, confidenceOverall: confidence.overall });
  const narrative = buildDecisionNarrative({
    context,
    appliedRules,
    riskLevel,
    alternativeActions,
    missingEvidence,
    recommendedAction,
  });

  const odp = await createAOEOperationalDecisionPackage({
    aoeCaseId: context.aoeCase._id,
    proposalId: context.proposal?._id,
    decisionType: decisionTypeForCase(context.aoeCase.type),
    decisionEngineVersion: context.platformConfiguration.decisionEngineVersion,
    facts,
    interpretation,
    appliedRules,
    evidenceSummary: {
      count: context.evidence.length,
      averageConfidence: confidence.evidence,
      summaries: context.evidence.map((item) => item.summary).slice(0, 10),
    },
    analyticsSummary: context.analyticsSummary,
    qualitySummary: context.qualitySummary,
    confidence,
    uncertainty,
    riskLevel,
    missingEvidence,
    requiredHumanSkills,
    recommendedAction,
    alternativeActions,
    narrative,
    humanReviewRequired: true,
    outcomePreparation: {
      businessOutcome: null,
      operationalOutcome: null,
      knowledgeOutcome: null,
    },
    generatedAt,
    expiresAt,
    status: 'generated',
  });

  await audit(String(input.actorId || 'system'), aoeOperationalDecisionAuditActions.created, {
    aoeOperationalDecisionPackageId: String(odp._id),
    aoeCaseId: String(context.aoeCase._id),
    decisionType: odp.decisionType,
  });
  if (context.qualitySummary.recommendedMode !== 'normal') {
    await audit('system', aoeOperationalDecisionAuditActions.degradedMode, {
      aoeOperationalDecisionPackageId: String(odp._id),
      recommendedMode: context.qualitySummary.recommendedMode,
      failedGates: context.qualitySummary.failedGates,
    });
  }
  await recordAnalyticsEvent({
    domain: 'aoe',
    eventType: aoeOperationalDecisionAuditActions.created,
    entityType: 'platform',
    entityId: odp._id,
    actorId: input.actorId && Types.ObjectId.isValid(String(input.actorId)) ? input.actorId : null,
    metadata: {
      aoeCaseId: String(context.aoeCase._id),
      decisionType: odp.decisionType,
      riskLevel: odp.riskLevel,
      degradedMode: context.qualitySummary.recommendedMode !== 'normal',
    },
    tags: ['aoe', 'system'],
    source: 'aoe',
    analyticsCategory: 'operational',
  });
  return odp;
}

export async function listAOEOperationalDecisions(input: { page?: unknown; limit?: unknown } = {}) {
  const pagination = normalizePagination(input);
  const [total, operationalDecisions] = await Promise.all([
    countAOEOperationalDecisionPackages(),
    listAOEOperationalDecisionPackages(pagination.skip, pagination.limit),
  ]);
  return { page: pagination.page, limit: pagination.limit, total, operationalDecisions };
}

export async function getAOEOperationalDecision(id: string | Types.ObjectId) {
  const odp = await findAOEOperationalDecisionPackageById(toObjectId(id));
  if (!odp) reject(404, 'aoe_operational_decision_not_found');
  return odp;
}

export async function getOrCreateAOEOperationalDecisionForCase(input: AOEOperationalDecisionInput) {
  const aoeCaseId = toObjectId(input.aoeCaseId);
  const existing = await findLatestAOEOperationalDecisionForCase(aoeCaseId);
  if (existing) return existing;
  return generateAOEOperationalDecisionPackage(input);
}

export async function setAOEOperationalDecisionPackageStatus(input: {
  id: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
  status: Exclude<AOEOperationalDecisionStatus, 'generated'>;
}) {
  const odp = await setAOEOperationalDecisionStatus(toObjectId(input.id), input.status);
  if (!odp) reject(404, 'aoe_operational_decision_not_found');
  const actionByStatus = {
    viewed: aoeOperationalDecisionAuditActions.viewed,
    escalated: aoeOperationalDecisionAuditActions.escalated,
    closed: aoeOperationalDecisionAuditActions.closed,
  };
  await audit(String(input.actorId), actionByStatus[input.status], {
    aoeOperationalDecisionPackageId: String(odp._id),
    aoeCaseId: String(odp.aoeCaseId),
  });
  return odp;
}
