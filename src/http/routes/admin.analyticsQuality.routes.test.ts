import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Audit } from '../../domain/audit/audit.model';
import { AnalyticsEvent } from '../../domain/analytics/analyticsEvent.model';
import { expectedAnalyticsEvents, getAnalyticsCoverage } from '../../domain/analytics/analyticsCoverage.service';
import {
  getAnalyticsCompleteness,
  getAnalyticsFreshness,
  getAnalyticsIntegrity,
  getAnalyticsLatency,
  getCorrelationQuality,
  getDimensionsQuality,
  getTagsQuality,
} from '../../domain/analytics/analyticsIntegrity.service';
import { AnalyticsQualitySnapshot } from '../../domain/analytics/analyticsQuality.model';
import {
  analyticsQualityAuditActions,
  calculateAnalyticsQualityScore,
  generateAnalyticsQualitySnapshot,
  getAnalyticsQualityHealth,
  getAnalyticsQualityTrend,
  getAnalyticsReadiness,
  validateAnalyticsReadiness,
} from '../../domain/analytics/analyticsQuality.service';
import { recordAnalyticsEvent } from '../../domain/analytics/analytics.service';
import {
  getConfigValue,
  seedSandboxDefaultConfigurations,
} from '../../domain/platformConfiguration/platformConfiguration.service';
import { getAOECapabilities } from '../../domain/aoe/aoeCapabilities.service';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createTestUser } from '../../test/helpers/factories';

let app: typeof import('../../app').default;

const relevantAuditActions = [
  'AUCTION_DEFAULT_CONFIRMED',
  'AUCTION_SANCTION_APPLIED',
  'AOE_CASE_CREATED',
  'AOE_DECISION_PROPOSAL_CREATED',
];

async function seedExpectedAnalytics(options: { correlation?: boolean; dimensions?: boolean; tags?: boolean } = {}) {
  const correlation = options.correlation !== false;
  const dimensions = options.dimensions !== false;
  const tags = options.tags !== false;
  for (const [domain, eventTypes] of Object.entries(expectedAnalyticsEvents)) {
    for (const eventType of eventTypes) {
      await recordAnalyticsEvent({
        domain: domain as any,
        eventType,
        entityType: domain === 'aoe' ? 'platform' : domain,
        entityId: new Types.ObjectId(),
        metadata: { seeded: true },
        dimensions: dimensions ? { environment: 'sandbox', channel: 'test' } : {},
        tags: tags ? [domain === 'auction_listings' ? 'auction' : domain] : [],
        correlationId: correlation ? `corr-${domain}-${eventType}` : null,
      });
    }
  }
}

async function seedCompletenessAudits() {
  for (const action of relevantAuditActions) {
    await Audit.create({ actor: 'system', action });
  }
}

describe('Analytics platform observability validation', () => {
  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  it('keeps AnalyticsQualitySnapshot append-only', async () => {
    const snapshot = await AnalyticsQualitySnapshot.create({
      score: 80,
      classification: 'READY',
      health: 'WARNING',
      coverage: {},
      correlation: {},
      integrity: {},
      completeness: {},
      dimensions: {},
      tags: {},
      freshness: {},
      latency: {},
      generatedAt: new Date(),
    });
    await expect(AnalyticsQualitySnapshot.updateOne({ _id: snapshot._id }, { $set: { score: 90 } }))
      .rejects.toThrow('analytics_quality_snapshot_append_only');
    await expect(AnalyticsQualitySnapshot.deleteOne({ _id: snapshot._id }))
      .rejects.toThrow('analytics_quality_snapshot_append_only');
  });

  it('calculates score, classification and health bands', () => {
    expect(calculateAnalyticsQualityScore({
      coverage: 0,
      integrity: 0,
      completeness: 0,
      correlation: 0,
      dimensions: 0,
      tags: 0,
    })).toMatchObject({ score: 0, classification: 'NOT_READY', health: 'CRITICAL' });
    expect(calculateAnalyticsQualityScore({
      coverage: 60,
      integrity: 60,
      completeness: 60,
      correlation: 60,
      dimensions: 60,
      tags: 60,
    })).toMatchObject({ score: 60, classification: 'PARTIALLY_READY', health: 'CRITICAL' });
    expect(calculateAnalyticsQualityScore({
      coverage: 80,
      integrity: 80,
      completeness: 80,
      correlation: 80,
      dimensions: 80,
      tags: 80,
    })).toMatchObject({ score: 80, classification: 'READY', health: 'WARNING' });
    expect(calculateAnalyticsQualityScore({
      coverage: 95,
      integrity: 95,
      completeness: 95,
      correlation: 95,
      dimensions: 95,
      tags: 95,
    })).toMatchObject({ score: 95, classification: 'PRODUCTION_READY', health: 'HEALTHY' });
    expect(getAnalyticsQualityHealth(74)).toBe('CRITICAL');
    expect(getAnalyticsQualityHealth(75)).toBe('WARNING');
    expect(getAnalyticsQualityHealth(90)).toBe('HEALTHY');
  });

  it('returns readiness without a boolean ready flag and includes quality sections', async () => {
    const readiness = await getAnalyticsReadiness();
    expect(readiness).toHaveProperty('overallScore');
    expect(readiness).toHaveProperty('classification');
    expect(readiness).not.toHaveProperty('ready');
    expect(readiness.coverage).toBeDefined();
    expect(readiness.correlation).toBeDefined();
    expect(readiness.integrity).toBeDefined();
    expect(readiness.completeness).toBeDefined();
  });

  it('measures coverage by domain and eventType', async () => {
    await recordAnalyticsEvent({
      domain: 'messaging',
      eventType: 'MESSAGE_SENT',
      entityType: 'conversation',
      entityId: new Types.ObjectId(),
      metadata: { seeded: true },
      tags: ['messaging'],
    });
    const coverage = await getAnalyticsCoverage();
    expect(coverage.domains.messaging.events.MESSAGE_SENT).toBe(100);
    expect(coverage.domains.messaging.events.CONVERSATION_CREATED).toBe(0);
  });

  it('measures correlation, dimensions, tags, integrity and completeness quality', async () => {
    await recordAnalyticsEvent({
      domain: 'aoe',
      eventType: 'AOE_CASE_CREATED',
      entityType: 'platform',
      entityId: new Types.ObjectId(),
      metadata: { case: true },
      dimensions: { environment: 'sandbox' },
      tags: ['aoe'],
      correlationId: 'corr-quality',
    });
    await recordAnalyticsEvent({
      domain: 'aoe',
      eventType: 'AOE_DECISION_PROPOSAL_CREATED',
      entityType: 'platform',
      entityId: new Types.ObjectId(),
      metadata: {},
      tags: [],
    });
    await seedCompletenessAudits();

    await expect(getCorrelationQuality()).resolves.toMatchObject({
      totalEvents: 2,
      correlatedEvents: 1,
      missingCorrelation: 1,
      correlationCoverage: 50,
    });
    await expect(getDimensionsQuality()).resolves.toMatchObject({
      totalEvents: 2,
      eventsWithDimensions: 1,
      dimensionCoverage: 50,
    });
    await expect(getTagsQuality()).resolves.toMatchObject({
      totalEvents: 2,
      taggedEvents: 1,
      tagCoverage: 50,
    });
    const integrity = await getAnalyticsIntegrity();
    expect(integrity.invalidMetadataCount).toBe(1);
    expect(integrity.issues).toContain('empty_metadata_detected');
    const completeness = await getAnalyticsCompleteness();
    expect(completeness.auditEvents).toBe(4);
    expect(completeness.matchedEvents).toBe(2);
    expect(completeness.completenessScore).toBe(50);
  });

  it('measures freshness states and latency statistics', async () => {
    await expect(getAnalyticsFreshness()).resolves.toMatchObject({ status: 'no_data' });
    await recordAnalyticsEvent({
      domain: 'platform',
      eventType: 'FRESH_EVENT',
      entityType: 'platform',
      entityId: new Types.ObjectId(),
      metadata: { fresh: true },
      occurredAt: new Date(Date.now() - 60_000),
      tags: ['system'],
    });
    await expect(getAnalyticsFreshness()).resolves.toMatchObject({ status: 'fresh' });
    await AnalyticsEvent.collection.deleteMany({});
    await recordAnalyticsEvent({
      domain: 'platform',
      eventType: 'DELAYED_EVENT',
      entityType: 'platform',
      entityId: new Types.ObjectId(),
      metadata: { delayed: true },
      occurredAt: new Date(Date.now() - 600_000),
      tags: ['system'],
    });
    await expect(getAnalyticsFreshness()).resolves.toMatchObject({ status: 'delayed' });
    await AnalyticsEvent.collection.deleteMany({});
    await recordAnalyticsEvent({
      domain: 'platform',
      eventType: 'STALE_EVENT',
      entityType: 'platform',
      entityId: new Types.ObjectId(),
      metadata: { stale: true },
      occurredAt: new Date(Date.now() - 3_600_000),
      tags: ['system'],
    });
    await expect(getAnalyticsFreshness()).resolves.toMatchObject({ status: 'stale' });
    const latency = await getAnalyticsLatency();
    expect(latency.sampleSize).toBe(1);
    expect(latency.avgLatencyMs).toBeGreaterThanOrEqual(0);
    expect(latency.p95LatencyMs).toBeGreaterThanOrEqual(0);
    expect(latency.maxLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('calculates trend states from snapshots', async () => {
    expect((await getAnalyticsQualityTrend(70)).trend).toBe('insufficient_history');
    await AnalyticsQualitySnapshot.create({
      score: 60,
      classification: 'PARTIALLY_READY',
      health: 'CRITICAL',
      coverage: {},
      correlation: {},
      integrity: {},
      completeness: {},
      dimensions: {},
      tags: {},
      freshness: {},
      latency: {},
      generatedAt: new Date(),
    });
    expect(await getAnalyticsQualityTrend(70)).toMatchObject({ trend: 'improving', delta: 10 });
    expect(await getAnalyticsQualityTrend(60)).toMatchObject({ trend: 'stable', delta: 0 });
    expect(await getAnalyticsQualityTrend(40)).toMatchObject({ trend: 'degrading', delta: -20 });
  });

  it('validates quality gates with normal, degraded, audit_fallback and blocked modes', async () => {
    await seedExpectedAnalytics();
    await seedCompletenessAudits();
    await expect(validateAnalyticsReadiness()).resolves.toMatchObject({ passed: true, recommendedMode: 'normal' });

    await AnalyticsEvent.collection.deleteMany({});
    await Audit.collection.deleteMany({});
    await expect(validateAnalyticsReadiness()).resolves.toMatchObject({ passed: false, recommendedMode: 'degraded' });

    await seedExpectedAnalytics();
    await AnalyticsEvent.collection.insertOne({
      domain: 'platform',
      eventType: 'INVALID_ENTITY',
      entityType: 'platform',
      occurredAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: { invalid: true },
      dimensions: { environment: 'sandbox' },
      tags: ['system'],
      analyticsCategory: 'operational',
      source: 'system',
      version: 1,
      correlationId: 'corr-invalid',
    } as any);
    await expect(validateAnalyticsReadiness()).resolves.toMatchObject({
      passed: false,
      recommendedMode: 'audit_fallback',
    });

    await AnalyticsEvent.collection.deleteMany({});
    await Audit.collection.deleteMany({});
    await Audit.create({ actor: 'system', action: 'AUCTION_DEFAULT_CONFIRMED' });
    await recordAnalyticsEvent({
      domain: 'platform',
      eventType: 'UNRELATED_EVENT',
      entityType: 'platform',
      entityId: new Types.ObjectId(),
      metadata: { unrelated: true },
      tags: ['system'],
    });
    await expect(validateAnalyticsReadiness()).resolves.toMatchObject({
      passed: false,
      recommendedMode: 'blocked',
    });
  });

  it('generates snapshots and audits snapshot creation', async () => {
    const snapshot = await generateAnalyticsQualitySnapshot('system');
    expect(snapshot.score).toBeGreaterThanOrEqual(0);
    expect(await AnalyticsQualitySnapshot.countDocuments()).toBe(1);
    expect(await Audit.exists({ action: analyticsQualityAuditActions.snapshotCreated })).toBeTruthy();
  });

  it('seeds PCC thresholds for Analytics Quality', async () => {
    const superUser = await createTestUser('super');
    await seedSandboxDefaultConfigurations(superUser._id);
    await expect(getConfigValue('analytics.quality.coverageThreshold', 'sandbox')).resolves.toBe(95);
    await expect(getConfigValue('analytics.quality.integrityThreshold', 'sandbox')).resolves.toBe(98);
    await expect(getConfigValue('analytics.quality.completenessThreshold', 'sandbox')).resolves.toBe(95);
    await expect(getConfigValue('analytics.quality.correlationThreshold', 'sandbox')).resolves.toBe(90);
    await expect(getConfigValue('analytics.quality.freshnessFreshSeconds', 'sandbox')).resolves.toBe(300);
    await expect(getConfigValue('analytics.quality.freshnessStaleSeconds', 'sandbox')).resolves.toBe(1800);
  });

  it('protects admin endpoints and exposes quality views', async () => {
    const admin = await createTestUser('admin');
    const user = await createTestUser('user');
    await recordAnalyticsEvent({
      domain: 'platform',
      eventType: 'QUALITY_ENDPOINT_EVENT',
      entityType: 'platform',
      entityId: new Types.ObjectId(),
      metadata: { endpoint: true },
      tags: ['system'],
      correlationId: 'corr-endpoint',
    });

    await request(app).get('/admin/analytics/quality').expect(401);
    await request(app)
      .get('/admin/analytics/quality')
      .set('Authorization', bearer(createAccessToken(user._id, 'user')))
      .expect(403);

    const token = bearer(createAccessToken(admin._id, 'admin'));
    for (const path of [
      '/admin/analytics/quality',
      '/admin/analytics/readiness',
      '/admin/analytics/coverage',
      '/admin/analytics/correlation',
      '/admin/analytics/dimensions',
      '/admin/analytics/tags',
      '/admin/analytics/integrity',
      '/admin/analytics/completeness',
      '/admin/analytics/freshness',
      '/admin/analytics/latency',
      '/admin/analytics/trend',
    ]) {
      await request(app).get(path).set('Authorization', token).expect(200);
    }
    await request(app)
      .post('/admin/analytics/quality/snapshot')
      .set('Authorization', token)
      .expect(201)
      .expect((res) => {
        expect(res.body.score).toBeGreaterThanOrEqual(0);
      });
  });

  it('adds analyticsQuality to Admin Control Center and does not alter AOE execution', async () => {
    const admin = await createTestUser('admin');
    await recordAnalyticsEvent({
      domain: 'aoe',
      eventType: 'AOE_CASE_CREATED',
      entityType: 'platform',
      entityId: new Types.ObjectId(),
      metadata: { aoe: true },
      tags: ['aoe'],
      correlationId: 'corr-aoe',
    });

    await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .expect(200)
      .expect((res) => {
        expect(res.body.analyticsQuality).toMatchObject({
          score: expect.any(Number),
          classification: expect.any(String),
          health: expect.any(String),
          coverage: expect.any(Number),
          correlation: expect.any(Number),
          integrity: expect.any(Number),
          completeness: expect.any(Number),
          freshness: expect.any(String),
          trend: expect.any(String),
        });
      });
    expect(getAOECapabilities().execution).toBe(false);
  });

  it('does not implement ML, scoring reputacional, reputation or prediction surfaces', async () => {
    const readiness = await getAnalyticsReadiness();
    expect(readiness).not.toHaveProperty('machineLearning');
    expect(readiness).not.toHaveProperty('reputation');
    expect(readiness).not.toHaveProperty('prediction');
    expect(readiness).not.toHaveProperty('embedding');
    expect(readiness).not.toHaveProperty('autonomousExecution');
  });
});
