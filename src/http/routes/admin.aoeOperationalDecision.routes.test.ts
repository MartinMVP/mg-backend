import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Audit } from '../../domain/audit/audit.model';
import { addAOEEvidence } from '../../domain/aoe/aoeEvidence.service';
import { createPlatformAOECase } from '../../domain/aoe/aoeCase.service';
import { buildAOEDecisionProposal } from '../../domain/aoe/aoeDecisionProposal.service';
import { AuctionSanction } from '../../domain/auctionSanctions/auctionSanction.model';
import { expectedAnalyticsEvents } from '../../domain/analytics/analyticsCoverage.service';
import { recordAnalyticsEvent } from '../../domain/analytics/analytics.service';
import {
  generateAOEOperationalDecisionPackage,
  aoeOperationalDecisionAuditActions,
  setAOEOperationalDecisionPackageStatus,
} from '../../domain/aoeOperationalDecisions/aoeOperationalDecision.service';
import { calculateAOEDecisionConfidence } from '../../domain/aoeOperationalDecisions/aoeDecisionConfidence.service';
import { buildAOEDecisionContext } from '../../domain/aoeOperationalDecisions/aoeDecisionContext.service';
import { calculateDecisionRisk } from '../../domain/aoeOperationalDecisions/aoeDecisionRisk.service';
import { seedSandboxDefaultConfigurations } from '../../domain/platformConfiguration/platformConfiguration.service';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createTestUser } from '../../test/helpers/factories';

let app: typeof import('../../app').default;

async function seedExpectedAnalyticsQuality() {
  for (const [domain, eventTypes] of Object.entries(expectedAnalyticsEvents)) {
    for (const eventType of eventTypes) {
      await recordAnalyticsEvent({
        domain: domain as any,
        eventType,
        entityType: 'platform',
        entityId: new Types.ObjectId(),
        metadata: { seeded: true },
        dimensions: { environment: 'sandbox', channel: 'test' },
        tags: ['aoe', 'system'],
        correlationId: `corr-${domain}-${eventType}`,
      });
    }
  }
  for (const action of [
    'AUCTION_DEFAULT_CONFIRMED',
    'AUCTION_SANCTION_APPLIED',
    'AOE_CASE_CREATED',
    'AOE_DECISION_PROPOSAL_CREATED',
  ]) {
    await Audit.create({ actor: 'system', action });
  }
  for (let index = 0; index < 5; index += 1) {
    await recordAnalyticsEvent({
      domain: 'platform',
      eventType: `CORRELATED_SUPPORT_${index}`,
      entityType: 'platform',
      entityId: new Types.ObjectId(),
      metadata: { support: true },
      dimensions: { environment: 'sandbox', channel: 'test' },
      tags: ['system'],
      correlationId: `corr-support-${index}`,
    });
  }
}

async function createAOECaseWithProposal() {
  const aoeCase = await createPlatformAOECase({
    type: 'auction_default',
    entityType: 'auction',
    entityId: new Types.ObjectId(),
    priority: 'high',
  });
  await addAOEEvidence({
    aoeCaseId: aoeCase._id,
    sourceType: 'auction',
    sourceId: new Types.ObjectId(),
    summary: 'buyer default confirmed with seller response and buyer response',
    confidence: 95,
  });
  await addAOEEvidence({
    aoeCaseId: aoeCase._id,
    sourceType: 'audit',
    sourceId: new Types.ObjectId(),
    summary: 'admin confirmation available for default review',
    confidence: 90,
  });
  const proposal = await buildAOEDecisionProposal(aoeCase._id);
  return { aoeCase, proposal };
}

describe('AOE Operational Decision Packages', () => {
  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  it('creates an ODP with facts separated from interpretation, rule trace and engine version', async () => {
    await seedExpectedAnalyticsQuality();
    const { aoeCase, proposal } = await createAOECaseWithProposal();
    const odp = await generateAOEOperationalDecisionPackage({
      aoeCaseId: aoeCase._id,
      proposalId: proposal._id,
      actorId: 'system',
    });

    expect(odp.decisionType).toBe('default_review');
    expect(odp.decisionEngineVersion).toBe('AOE Decision Engine v1.0');
    expect(odp.facts).toMatchObject({
      evidenceItems: 2,
      proposalAvailable: true,
    });
    expect(odp.interpretation).toMatchObject({
      escalationRecommended: expect.any(Boolean),
      confidenceBand: expect.any(String),
    });
    expect(odp.appliedRules).toEqual(expect.arrayContaining(['GCD-0', 'GCD-9', 'GCD-3A.1']));
    expect(odp.status).toBe('generated');
    expect(odp).not.toHaveProperty('approved');
    expect(odp).not.toHaveProperty('executed');
  });

  it('builds deterministic confidence, uncertainty, risk, missing evidence, skills and alternatives', async () => {
    await seedExpectedAnalyticsQuality();
    const { aoeCase } = await createAOECaseWithProposal();
    const context = await buildAOEDecisionContext({ aoeCaseId: aoeCase._id });
    const confidence = calculateAOEDecisionConfidence(context);
    const risk = calculateDecisionRisk(context, confidence);
    const odp = await generateAOEOperationalDecisionPackage({ aoeCaseId: aoeCase._id });

    expect(confidence).toMatchObject({
      overall: expect.any(Number),
      evidence: expect.any(Number),
      analytics: expect.any(Number),
      historical: expect.any(Number),
      consistency: expect.any(Number),
    });
    expect(['low', 'medium', 'high']).toContain(odp.uncertainty);
    expect(['low', 'medium', 'high', 'critical']).toContain(risk);
    expect(odp.missingEvidence).toEqual(expect.any(Array));
    expect(odp.requiredHumanSkills).toEqual(expect.arrayContaining(['operations', 'auctions']));
    expect(odp.alternativeActions).toEqual(expect.arrayContaining(['no_action', 'warning', 'escalate', 'request_more_evidence']));
    expect(odp.recommendedAction).toEqual(expect.any(String));
    expect(odp.humanReviewRequired).toBe(true);
  });

  it('builds deterministic narrative and expiration without natural-language generation', async () => {
    const { aoeCase } = await createAOECaseWithProposal();
    const odp = await generateAOEOperationalDecisionPackage({ aoeCaseId: aoeCase._id });
    expect(odp.narrative).toMatchObject({
      whatHappened: expect.any(String),
      evidenceAvailable: expect.any(String),
      rulesApplied: expect.any(Array),
      risks: expect.any(Array),
      alternatives: expect.any(Array),
      missingInformation: expect.any(Array),
      recommendation: expect.any(String),
    });
    expect(new Date(odp.expiresAt).getTime()).toBeGreaterThan(new Date(odp.generatedAt).getTime());
    expect((odp.narrative as any).note).toContain('without autonomous execution');
  });

  it('uses quality gates OK when Analytics is ready and degraded audit fallback when it is not', async () => {
    await seedExpectedAnalyticsQuality();
    const ready = await createAOECaseWithProposal();
    const readyOdp = await generateAOEOperationalDecisionPackage({ aoeCaseId: ready.aoeCase._id });
    expect((readyOdp.qualitySummary as any).recommendedMode).toBe('normal');

    await Audit.collection.deleteMany({});
    const degraded = await createAOECaseWithProposal();
    const degradedOdp = await generateAOEOperationalDecisionPackage({ aoeCaseId: degraded.aoeCase._id });
    expect((degradedOdp.qualitySummary as any).recommendedMode).not.toBe('normal');
    expect(await Audit.exists({ action: aoeOperationalDecisionAuditActions.degradedMode })).toBeTruthy();
  });

  it('audits ODP lifecycle and does not execute sanctions or autonomous actions', async () => {
    const { aoeCase } = await createAOECaseWithProposal();
    const odp = await generateAOEOperationalDecisionPackage({ aoeCaseId: aoeCase._id });
    await setAOEOperationalDecisionPackageStatus({ id: odp._id, actorId: 'system', status: 'viewed' });
    await setAOEOperationalDecisionPackageStatus({ id: odp._id, actorId: 'system', status: 'escalated' });
    await setAOEOperationalDecisionPackageStatus({ id: odp._id, actorId: 'system', status: 'closed' });

    expect(await Audit.exists({ action: aoeOperationalDecisionAuditActions.created })).toBeTruthy();
    expect(await Audit.exists({ action: aoeOperationalDecisionAuditActions.viewed })).toBeTruthy();
    expect(await Audit.exists({ action: aoeOperationalDecisionAuditActions.escalated })).toBeTruthy();
    expect(await Audit.exists({ action: aoeOperationalDecisionAuditActions.closed })).toBeTruthy();
    expect(await AuctionSanction.countDocuments()).toBe(0);
  });

  it('protects admin endpoints and exposes ODP lifecycle routes', async () => {
    const admin = await createTestUser('admin');
    const user = await createTestUser('user');
    await seedSandboxDefaultConfigurations(admin._id);
    const { aoeCase } = await createAOECaseWithProposal();
    const token = bearer(createAccessToken(admin._id, 'admin'));

    await request(app).get('/admin/aoe/operational-decisions').expect(401);
    await request(app)
      .get('/admin/aoe/operational-decisions')
      .set('Authorization', bearer(createAccessToken(user._id, 'user')))
      .expect(403);

    const generated = await request(app)
      .get(`/admin/aoe/cases/${aoeCase._id}/operational-decision`)
      .set('Authorization', token)
      .expect(200);
    const id = generated.body._id;

    await request(app).get('/admin/aoe/operational-decisions').set('Authorization', token).expect(200);
    await request(app).get(`/admin/aoe/operational-decisions/${id}`).set('Authorization', token).expect(200);
    await request(app).post(`/admin/aoe/operational-decisions/${id}/view`).set('Authorization', token).expect(200);
    await request(app).post(`/admin/aoe/operational-decisions/${id}/escalate`).set('Authorization', token).expect(200);
    await request(app)
      .post(`/admin/aoe/operational-decisions/${id}/close`)
      .set('Authorization', token)
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('closed');
      });
  });

  it('adds Admin Control Center metrics for ODPs', async () => {
    const admin = await createTestUser('admin');
    const { aoeCase } = await createAOECaseWithProposal();
    await generateAOEOperationalDecisionPackage({ aoeCaseId: aoeCase._id });

    await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .expect(200)
      .expect((res) => {
        expect(res.body.aoeOperationalDecisions).toMatchObject({
          totalGenerated: 1,
          viewed: 0,
          escalated: 0,
          closed: 0,
          averageConfidence: expect.any(Number),
          degradedModeUsage: expect.any(Number),
        });
      });
  });

  it('does not expose ML, scoring, reputation or prediction fields', async () => {
    const { aoeCase } = await createAOECaseWithProposal();
    const odp = await generateAOEOperationalDecisionPackage({ aoeCaseId: aoeCase._id });
    const raw = odp.toObject();
    expect(raw).not.toHaveProperty('machineLearning');
    expect(raw).not.toHaveProperty('score');
    expect(raw).not.toHaveProperty('reputation');
    expect(raw).not.toHaveProperty('prediction');
    expect(raw).not.toHaveProperty('embedding');
    expect(raw).not.toHaveProperty('autonomousExecution');
  });
});
