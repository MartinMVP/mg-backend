import { Audit } from '../audit/audit.model';
import { getConfigValue } from '../platformConfiguration/platformConfiguration.service';
import { getAnalyticsCoverage } from './analyticsCoverage.service';
import {
  getAnalyticsCompleteness,
  getAnalyticsFreshness,
  getAnalyticsIntegrity,
  getAnalyticsLatency,
  getCorrelationQuality,
  getDimensionsQuality,
  getTagsQuality,
} from './analyticsIntegrity.service';
import { AnalyticsQualitySnapshot } from './analyticsQuality.model';
import {
  AnalyticsQualityClassification,
  AnalyticsQualityGates,
  AnalyticsQualityHealth,
  AnalyticsQualityScore,
  AnalyticsQualityTrendResult,
  AnalyticsReadiness,
} from './analyticsQuality.types';

export const analyticsQualityAuditActions = {
  qualityCheck: 'ANALYTICS_QUALITY_CHECK',
  readinessCheck: 'ANALYTICS_READINESS_CHECK',
  snapshotCreated: 'ANALYTICS_QUALITY_SNAPSHOT_CREATED',
} as const;

type ScoreInput = {
  coverage: number;
  integrity: number;
  completeness: number;
  correlation: number;
  dimensions: number;
  tags: number;
};

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function classifyAnalyticsQuality(score: number): AnalyticsQualityClassification {
  if (score >= 90) return 'PRODUCTION_READY';
  if (score >= 75) return 'READY';
  if (score >= 50) return 'PARTIALLY_READY';
  return 'NOT_READY';
}

export function getAnalyticsQualityHealth(score: number): AnalyticsQualityHealth {
  if (score >= 90) return 'HEALTHY';
  if (score >= 75) return 'WARNING';
  return 'CRITICAL';
}

export function calculateAnalyticsQualityScore(input: ScoreInput): AnalyticsQualityScore {
  const score = clampScore(
    input.coverage * 0.3
    + input.integrity * 0.3
    + input.completeness * 0.2
    + input.correlation * 0.1
    + input.dimensions * 0.05
    + input.tags * 0.05
  );
  return {
    score,
    classification: classifyAnalyticsQuality(score),
    health: getAnalyticsQualityHealth(score),
  };
}

async function audit(actor: string, action: string, payload: Record<string, unknown>) {
  await Audit.create({ actor, action, payload });
}

function buildRecommendation(classification: AnalyticsQualityClassification) {
  if (classification === 'PRODUCTION_READY') return 'Analytics can be trusted for production-grade consumers.';
  if (classification === 'READY') return 'Analytics is usable with operational monitoring.';
  if (classification === 'PARTIALLY_READY') return 'Analytics should be consumed with audit fallback.';
  return 'Analytics requires validation before becoming a critical dependency.';
}

function collectIssues(readiness: Pick<AnalyticsReadiness, 'coverage' | 'correlation' | 'integrity' | 'completeness'>) {
  const blockingIssues: string[] = [];
  const warnings: string[] = [];
  if (readiness.coverage.overall < 75) blockingIssues.push('analytics_coverage_low');
  if (readiness.integrity.score < 75) blockingIssues.push('analytics_integrity_low');
  if (readiness.completeness.completenessScore < 75) blockingIssues.push('analytics_completeness_low');
  if (readiness.correlation.correlationCoverage < 50) warnings.push('analytics_correlation_low');
  if (readiness.integrity.issues.length > 0) warnings.push(...readiness.integrity.issues);
  if (readiness.completeness.warnings.length > 0) warnings.push(...readiness.completeness.warnings);
  return { blockingIssues, warnings: [...new Set(warnings)] };
}

export async function getAnalyticsReadiness(actorId?: string): Promise<AnalyticsReadiness> {
  const [
    coverage,
    correlation,
    integrity,
    completeness,
    dimensions,
    tags,
    freshness,
    latency,
  ] = await Promise.all([
    getAnalyticsCoverage(),
    getCorrelationQuality(),
    getAnalyticsIntegrity(),
    getAnalyticsCompleteness(),
    getDimensionsQuality(),
    getTagsQuality(),
    getAnalyticsFreshness(),
    getAnalyticsLatency(),
  ]);
  const quality = calculateAnalyticsQualityScore({
    coverage: coverage.overall,
    integrity: integrity.score,
    completeness: completeness.completenessScore,
    correlation: correlation.correlationCoverage,
    dimensions: dimensions.dimensionCoverage,
    tags: tags.tagCoverage,
  });
  const { blockingIssues, warnings } = collectIssues({ coverage, correlation, integrity, completeness });
  if (freshness.status === 'stale' || freshness.status === 'no_data') warnings.push(`analytics_freshness_${freshness.status}`);
  if (latency.warnings.length > 0) warnings.push(...latency.warnings);

  if (actorId) {
    await audit(actorId, analyticsQualityAuditActions.readinessCheck, {
      score: quality.score,
      classification: quality.classification,
    });
  }

  return {
    overallScore: quality.score,
    classification: quality.classification,
    health: quality.health,
    coverage,
    correlation,
    integrity,
    completeness,
    dimensions,
    tags,
    freshness,
    latency,
    recommendation: buildRecommendation(quality.classification),
    blockingIssues,
    warnings: [...new Set(warnings)],
    generatedAt: new Date().toISOString(),
  };
}

export async function getAnalyticsQuality(actorId?: string) {
  const readiness = await getAnalyticsReadiness();
  const result = {
    score: readiness.overallScore,
    classification: readiness.classification,
    health: readiness.health,
  };
  if (actorId) await audit(actorId, analyticsQualityAuditActions.qualityCheck, result);
  return result;
}

export async function getAnalyticsQualityTrend(currentScore?: number): Promise<AnalyticsQualityTrendResult> {
  const current = typeof currentScore === 'number' ? currentScore : (await getAnalyticsQuality()).score;
  const previous = await AnalyticsQualitySnapshot.findOne().sort({ createdAt: -1 }).select('score').lean();
  if (!previous) {
    return { previousScore: null, currentScore: current, delta: null, trend: 'insufficient_history' };
  }
  const delta = current - previous.score;
  const trend = delta > 2 ? 'improving' : delta < -2 ? 'degrading' : 'stable';
  return { previousScore: previous.score, currentScore: current, delta, trend };
}

export async function validateAnalyticsReadiness(): Promise<AnalyticsQualityGates> {
  const [readiness, coverageThreshold, integrityThreshold, completenessThreshold, correlationThreshold] = await Promise.all([
    getAnalyticsReadiness(),
    getConfigValue('analytics.quality.coverageThreshold', 'sandbox', 95),
    getConfigValue('analytics.quality.integrityThreshold', 'sandbox', 98),
    getConfigValue('analytics.quality.completenessThreshold', 'sandbox', 95),
    getConfigValue('analytics.quality.correlationThreshold', 'sandbox', 90),
  ]);
  const failedGates: string[] = [];
  if (readiness.coverage.overall <= Number(coverageThreshold)) failedGates.push('coverage');
  if (readiness.integrity.score <= Number(integrityThreshold)) failedGates.push('integrity');
  if (readiness.completeness.completenessScore <= Number(completenessThreshold)) failedGates.push('completeness');
  if (readiness.correlation.correlationCoverage <= Number(correlationThreshold)) failedGates.push('correlation');

  const passed = failedGates.length === 0;
  const recommendedMode = passed
    ? 'normal'
    : failedGates.length >= 3
      ? 'blocked'
      : failedGates.includes('integrity') || failedGates.includes('completeness')
        ? 'audit_fallback'
        : 'degraded';
  return {
    passed,
    failedGates,
    warnings: readiness.warnings,
    recommendedMode,
  };
}

export async function generateAnalyticsQualitySnapshot(actorId?: string) {
  const readiness = await getAnalyticsReadiness();
  const snapshot = await AnalyticsQualitySnapshot.create({
    score: readiness.overallScore,
    classification: readiness.classification,
    health: readiness.health,
    coverage: readiness.coverage,
    correlation: readiness.correlation,
    integrity: readiness.integrity,
    completeness: readiness.completeness,
    dimensions: readiness.dimensions,
    tags: readiness.tags,
    freshness: readiness.freshness,
    latency: readiness.latency,
    blockingIssues: readiness.blockingIssues,
    warnings: readiness.warnings,
    generatedAt: new Date(readiness.generatedAt),
  });
  await audit(actorId || 'system', analyticsQualityAuditActions.snapshotCreated, {
    analyticsQualitySnapshotId: String(snapshot._id),
    score: snapshot.score,
    classification: snapshot.classification,
  });
  return snapshot;
}
