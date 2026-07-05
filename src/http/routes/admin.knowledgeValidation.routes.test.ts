import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { User } from '../../domain/users/user.model';
import { signAccessToken } from '../../utils/jwt';
import { createKnowledgeAsset } from '../../domain/knowledge/knowledgeAsset.service';
import { createKnowledgeCollection } from '../../domain/knowledge/knowledgeCollection.service';
import { createKnowledgeRecord } from '../../domain/knowledge/knowledgeRecord.service';
import { resolveKnowledge } from '../../domain/knowledge/knowledgeResolution.service';
import { registerOutcome, outcomeAuditActions } from '../../domain/knowledge/knowledgeOutcome.service';
import {
  calculateKnowledgeStability,
  createValidationPolicy,
  detectKnowledgeDrift,
  getAOEValidationContext,
  knowledgeValidationAuditActions,
  prepareKnowledgeTrust,
  validateKnowledge,
} from '../../domain/knowledge/knowledgeValidation.service';
import {
  buildValidationResult,
  collectOutcome,
  compareExpectation,
  determineValidation,
} from '../../domain/knowledge/knowledgeValidationEngine.service';

async function auth(role: 'user' | 'admin' | 'super' = 'admin') {
  const user = await User.create({
    name: `${role} validation`,
    email: `${role}-${new Types.ObjectId()}@validation.local`,
    password: 'secret123',
    role,
  });
  return { user, header: `Bearer ${signAccessToken({ sub: String(user._id), role, typ: 'access' })}` };
}

const consumer = {
  consumerType: 'aoe' as const,
  ownerDomain: 'commercial_operations',
  steward: 'ops-steward',
  allowedDomains: ['commercial_listing'],
  allowedAssetTypes: ['operational_pattern'],
  minimumKnowledgeQuality: 'validated' as const,
  maximumKnowledgeAge: null,
  preferredLifecycle: ['approved', 'reusable'] as any,
  purposeCategory: 'validation_context',
};

const policy = {
  allowedDomains: ['commercial_listing'],
  minimumQuality: 'validated' as const,
  allowedLifecycle: ['approved', 'reusable'] as any,
  maximumPackageSize: 5,
  includeDeprecated: false,
  includeCandidate: false,
};

async function seedPackage() {
  const records = await Promise.all([1, 2].map((index) => createKnowledgeRecord({
    knowledgeDomain: 'commercial_listing',
    knowledgeType: 'validation_observation',
    sourceType: 'manual',
    sourceId: String(new Types.ObjectId()),
    facts: { index },
    context: { sprint: '11.0' },
    provenance: {
      generatedBy: 'manual',
      sourceEvidence: [{ sourceType: 'manual', sourceId: String(new Types.ObjectId()), description: `Evidence ${index}` }],
      rulesVersion: 'GCD-11',
      engineVersion: null,
      validatedBy: null,
      approvedBy: null,
      validatedAt: null,
      approvedAt: null,
    },
    producer: 'validation-test',
    actorId: 'system',
  } as any)));
  const collection = await createKnowledgeCollection({
    collectionType: 'case',
    title: 'Validation collection',
    description: 'Context for validation.',
    knowledgeRecords: records.map((record) => record._id),
    ownerDomain: 'commercial_operations',
    knowledgeSteward: 'ops-steward',
    actorId: 'system',
  });
  const secondCollection = await createKnowledgeCollection({
    collectionType: 'pattern',
    title: 'Validation pattern collection',
    description: 'Second context for validation.',
    knowledgeRecords: records.map((record) => record._id),
    ownerDomain: 'commercial_operations',
    knowledgeSteward: 'ops-steward',
    actorId: 'system',
  });
  const asset = await createKnowledgeAsset({
    assetType: 'operational_pattern',
    title: 'Validation asset',
    description: 'Asset to validate.',
    collections: [collection._id, secondCollection._id],
    domain: 'commercial_listing',
    ownerDomain: 'commercial_operations',
    knowledgeSteward: 'ops-steward',
    quality: { level: 'trusted', score: 80, rationale: 'Pre-validation quality.', evaluatedAt: new Date() },
    lifecycle: { stage: 'reusable', enteredAt: new Date(), updatedAt: new Date(), reason: 'Reusable.' },
    actorId: 'system',
  });
  const resolved = await resolveKnowledge({
    consumer,
    policy,
    domain: 'commercial_listing',
    objective: 'Validation package',
    actorId: 'system',
  });
  return { records, collection, asset, resolved };
}

describe('knowledge validation', () => {
  it('creates transverse OutcomeRegistry and audits registration', async () => {
    const outcome = await registerOutcome({
      outcomeType: 'successful',
      sourceDomain: 'AOE',
      sourceId: String(new Types.ObjectId()),
      businessOutcome: 'Business goal achieved.',
      operationalOutcome: 'Operational process completed.',
      knowledgeOutcome: 'Knowledge context was useful.',
      metadata: { marketplace: true, membership: true, revenue: true },
      actorId: 'system',
    });

    expect(outcome.tenantId).toBe('default');
    expect(outcome.sourceDomain).toBe('AOE');
    expect(outcome.metadata).toMatchObject({ marketplace: true, membership: true, revenue: true });
    await expect(Audit.exists({ action: outcomeAuditActions.registered })).resolves.toBeTruthy();
  });

  it('creates KnowledgeValidation with provenance, score, confidence and supported level only', async () => {
    const { resolved } = await seedPackage();
    const outcome = await registerOutcome({
      outcomeType: 'successful',
      sourceDomain: 'AOE',
      businessOutcome: 'Good',
      operationalOutcome: 'Done',
      knowledgeOutcome: 'Useful',
      actorId: 'system',
    });
    const validation = await validateKnowledge({
      packageId: String(resolved.package._id),
      snapshotId: String(resolved.snapshot._id),
      outcomeId: String(outcome._id),
      validationLevel: 'knowledge_validation',
      validationMethod: 'admin_review',
      actorId: 'system',
    });

    expect(validation.validation.validationLevel).toBe('knowledge_validation');
    expect(validation.validation.validationProvenance.validationVersion).toBe('Knowledge Validation v1.0');
    expect(validation.validation.validationScore.overall).toBeGreaterThan(0);
    expect(validation.validation.validationConfidence.overall).toBeGreaterThan(0);
    expect(validation.validationSnapshot).not.toHaveProperty('updatedAt');
    await expect(validateKnowledge({
      packageId: String(resolved.package._id),
      snapshotId: String(resolved.snapshot._id),
      outcomeId: String(outcome._id),
      validationLevel: 'rule_validation',
    })).rejects.toThrow('unsupported_validation_level');
  });

  it('implements deterministic validation policy and engine methods', async () => {
    const { resolved } = await seedPackage();
    const outcome = await registerOutcome({
      outcomeType: 'partially_successful',
      sourceDomain: 'Platform',
      businessOutcome: 'Partial',
      operationalOutcome: 'Mostly done',
      knowledgeOutcome: 'Partially useful',
      actorId: 'system',
    });
    const validationPolicy = await createValidationPolicy();
    const collected = await collectOutcome(outcome._id);
    const compared = compareExpectation(collected);
    const built = await buildValidationResult({ snapshotId: resolved.snapshot._id, outcomeId: outcome._id });

    expect(validationPolicy.minimumEvidence).toBe(60);
    expect(compared.outcomeScore).toBe(70);
    expect(determineValidation({ score: built.score, confidence: built.confidence })).toEqual(expect.any(String));
    expect(built.validationResult).toMatch(/confirmed|inconclusive|rejected/);
  });

  it('creates history, drift for all drift types, stability and trust preparation only', async () => {
    const { asset, resolved } = await seedPackage();
    const outcome = await registerOutcome({
      outcomeType: 'successful',
      sourceDomain: 'Compliance',
      businessOutcome: 'Compliant',
      operationalOutcome: 'Validated',
      knowledgeOutcome: 'Confirmed',
      actorId: 'system',
    });
    await validateKnowledge({
      packageId: String(resolved.package._id),
      snapshotId: String(resolved.snapshot._id),
      outcomeId: String(outcome._id),
      actorId: 'system',
    });

    for (const driftType of ['business', 'rule', 'evidence', 'outcome'] as const) {
      const drift = await detectKnowledgeDrift({ assetId: asset._id, driftType, previousScore: 90, currentScore: 50 });
      expect(drift.driftDetected).toBe(true);
    }
    const stability = await calculateKnowledgeStability(asset._id);
    const trust = await prepareKnowledgeTrust(asset._id);
    expect(stability.confirmations).toBeGreaterThan(0);
    expect(trust.prepared).toBe(true);
    expect(trust.trustReady).toBe(false);
  });

  it('provides AOE validation context without learning or rule adaptation', async () => {
    const { asset } = await seedPackage();
    const context = await getAOEValidationContext(String(asset._id));
    expect(context.contextOnly).toBe(true);
    expect(context.learningEnabled).toBe(false);
    expect(context.ruleAdaptationEnabled).toBe(false);
    expect(context.automationEnabled).toBe(false);
  });

  it('protects admin endpoints and exposes validation resources', async () => {
    const { header } = await auth('admin');
    const { header: userHeader } = await auth('user');
    const { resolved, asset } = await seedPackage();
    const outcome = await request(app).post('/admin/knowledge/outcomes').set('Authorization', header).send({
      outcomeType: 'successful',
      sourceDomain: 'AOE',
      businessOutcome: 'Business',
      operationalOutcome: 'Operational',
      knowledgeOutcome: 'Knowledge',
    }).expect(201);
    const validation = await request(app).post('/admin/knowledge/validate').set('Authorization', header).send({
      packageId: resolved.package._id,
      snapshotId: resolved.snapshot._id,
      outcomeId: outcome.body._id,
      validationLevel: 'knowledge_validation',
      validationMethod: 'human_review',
    }).expect(201);

    await request(app).get('/admin/knowledge/validations').expect(401);
    await request(app).get('/admin/knowledge/validations').set('Authorization', userHeader).expect(403);
    await request(app).get('/admin/knowledge/validations').set('Authorization', header).expect(200);
    await request(app).get(`/admin/knowledge/validations/${validation.body.validation._id}`).set('Authorization', header).expect(200);
    await request(app).get('/admin/knowledge/outcomes').set('Authorization', header).expect(200);
    await request(app).get(`/admin/knowledge/outcomes/${outcome.body._id}`).set('Authorization', header).expect(200);
    await request(app).get('/admin/knowledge/drift').set('Authorization', header).expect(200);
    await request(app).get(`/admin/knowledge/history/${asset._id}`).set('Authorization', header).expect(200);
  });

  it('adds knowledgeValidation to Admin Control Center and audits validation', async () => {
    const { header } = await auth('super');
    const { resolved } = await seedPackage();
    const outcome = await registerOutcome({
      outcomeType: 'successful',
      sourceDomain: 'AOE',
      businessOutcome: 'Done',
      operationalOutcome: 'Done',
      knowledgeOutcome: 'Confirmed',
      actorId: 'system',
    });
    await validateKnowledge({
      packageId: String(resolved.package._id),
      snapshotId: String(resolved.snapshot._id),
      outcomeId: String(outcome._id),
      actorId: 'system',
    });

    await request(app).get('/admin/control-center/dashboard').set('Authorization', header).expect(200)
      .expect((res) => {
        expect(res.body.knowledgeValidation.totalValidations).toBe(1);
        expect(res.body.knowledgeValidation.validationScore).toBeGreaterThan(0);
        expect(res.body.knowledgeValidation.byDomain).toEqual(expect.any(Array));
        expect(res.body.knowledgeValidation.byClassification).toEqual(expect.any(Array));
        expect(res.body.knowledgeValidation.authoritativeCandidates).toBeGreaterThanOrEqual(0);
      });
    await expect(Audit.exists({ action: knowledgeValidationAuditActions.validated })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: knowledgeValidationAuditActions.snapshotCreated })).resolves.toBeTruthy();
  });

  it('does not implement ML, AI, inference, rule adaptation, auto-promotion or automation', async () => {
    const { header } = await auth('admin');
    await request(app).post('/admin/knowledge/learn').set('Authorization', header).send({}).expect(404);
    await request(app).post('/admin/knowledge/infer').set('Authorization', header).send({}).expect(404);
    await request(app).post('/admin/knowledge/rule-adaptation').set('Authorization', header).send({}).expect(404);
    await request(app).post('/admin/knowledge/promote').set('Authorization', header).send({}).expect(404);
    await request(app).post('/admin/knowledge/automation').set('Authorization', header).send({}).expect(404);
  });
});
