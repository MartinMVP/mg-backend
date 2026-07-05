import { Types } from 'mongoose';
import { AOECase } from '../aoe/aoeCase.model';
import { AOEDecisionProposal } from '../aoe/aoeDecisionProposal.model';
import { listAOEEvidenceForCase, toObjectId } from '../aoe/aoeEvidence.service';
import { Audit } from '../audit/audit.model';
import { getAnalyticsContextForEntity } from '../analytics/analytics.service';
import { validateAnalyticsReadiness } from '../analytics/analyticsQuality.service';
import { getConfigValue } from '../platformConfiguration/platformConfiguration.service';
import { AOEDecisionContext } from './aoeDecision.types';

function reject(status: number, message: string): never {
  const error = new Error(message);
  (error as any).status = status;
  throw error;
}

export async function buildAOEDecisionContext(input: {
  aoeCaseId: string | Types.ObjectId;
  proposalId?: string | Types.ObjectId;
}): Promise<AOEDecisionContext> {
  const aoeCaseId = toObjectId(input.aoeCaseId);
  const aoeCase = await AOECase.findById(aoeCaseId).lean();
  if (!aoeCase) reject(404, 'aoe_case_not_found');

  const proposal = input.proposalId
    ? await AOEDecisionProposal.findById(toObjectId(input.proposalId)).lean()
    : await AOEDecisionProposal.findOne({ aoeCaseId }).sort({ createdAt: -1 }).lean();

  const [evidence, auditRows, analyticsSummary, qualitySummary, decisionEngineVersion, expirationDays] = await Promise.all([
    listAOEEvidenceForCase(aoeCaseId),
    Audit.aggregate<{ _id: string; count: number }>([
      {
        $match: {
          $or: [
            { 'payload.aoeCaseId': String(aoeCaseId) },
            { action: { $regex: /^AOE_/ } },
          ],
        },
      },
      { $group: { _id: '$action', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    getAnalyticsContextForEntity(aoeCase.entityType, aoeCase.entityId),
    validateAnalyticsReadiness(),
    getConfigValue('aoe.decisionEngineVersion', 'sandbox', 'AOE Decision Engine v1.0'),
    getConfigValue('aoe.operationalDecisionExpirationDays', 'sandbox', 14),
  ]);

  return {
    aoeCase,
    proposal,
    evidence,
    auditSummary: {
      totalEvents: auditRows.reduce((sum, row) => sum + row.count, 0),
      actions: auditRows.map((row) => ({ action: row._id, count: row.count })),
    },
    analyticsSummary: {
      totalEvents: analyticsSummary.totalEvents,
      tags: analyticsSummary.tags,
      domains: analyticsSummary.domains,
      correlationIds: analyticsSummary.correlationIds.map(String),
    },
    qualitySummary: {
      passed: qualitySummary.passed,
      failedGates: qualitySummary.failedGates,
      recommendedMode: qualitySummary.recommendedMode,
      warnings: qualitySummary.warnings,
    },
    platformConfiguration: {
      decisionEngineVersion: String(decisionEngineVersion),
      expirationDays: Number(expirationDays) || 14,
    },
  };
}
