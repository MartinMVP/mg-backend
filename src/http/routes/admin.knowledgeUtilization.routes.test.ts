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
import {
  createKnowledgeConsumer,
  validateKnowledgeConsumerContract,
} from '../../domain/knowledge/knowledgeConsumer.service';
import {
  createKnowledgeResolutionPolicy,
  validateKnowledgeResolutionPolicy,
} from '../../domain/knowledge/knowledgeResolutionPolicy.service';
import {
  determineEligibility,
  knowledgeUtilizationAuditActions,
  rankKnowledge,
  resolveKnowledge,
  selectKnowledge,
} from '../../domain/knowledge/knowledgeResolution.service';
import { KnowledgeUtilizationPackage } from '../../domain/knowledge/knowledgeUtilizationPackage.model';
import { KnowledgeSnapshot } from '../../domain/knowledge/knowledgeSnapshot.model';
import { observeKnowledge, utilizeKnowledge } from '../../domain/knowledge/knowledgePreservation.service';

async function auth(role: 'user' | 'admin' | 'super' = 'admin') {
  const user = await User.create({
    name: `${role} utilization`,
    email: `${role}-${new Types.ObjectId()}@utilization.local`,
    password: 'secret123',
    role,
  });
  return {
    user,
    header: `Bearer ${signAccessToken({ sub: String(user._id), role, typ: 'access' })}`,
  };
}

function consumer(consumerType: 'aoe' | 'analytics' | 'quality' | 'admin' = 'aoe'): any {
  return {
    consumerType,
    ownerDomain: 'commercial_operations',
    steward: 'ops-steward',
    allowedDomains: ['commercial_listing', 'commercial_transaction'],
    allowedAssetTypes: ['operational_pattern', 'business_pattern'],
    minimumKnowledgeQuality: 'validated' as const,
    maximumKnowledgeAge: null,
    preferredLifecycle: ['approved', 'reusable'],
    purposeCategory: 'decision_context',
  };
}

function policy(): any {
  return {
    allowedDomains: ['commercial_listing', 'commercial_transaction'],
    minimumQuality: 'validated' as const,
    allowedLifecycle: ['approved', 'reusable'],
    maximumPackageSize: 2,
    includeDeprecated: false,
    includeCandidate: false,
  };
}

async function seedKnowledge() {
  const records = await Promise.all([1, 2, 3].map((index) => createKnowledgeRecord({
    knowledgeDomain: index === 3 ? 'commercial_transaction' : 'commercial_listing',
    knowledgeType: 'utilization_observation',
    sourceType: 'manual',
    sourceId: String(new Types.ObjectId()),
    facts: { index },
    context: { sprint: '10.9.3' },
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
    producer: 'utilization-test',
    actorId: 'system',
  } as any)));

  const firstCollection = await createKnowledgeCollection({
    collectionType: 'case',
    title: 'Utilization case',
    description: 'Governed case context.',
    knowledgeRecords: [records[0]._id, records[1]._id],
    ownerDomain: 'commercial_operations',
    knowledgeSteward: 'ops-steward',
    actorId: 'system',
  });
  const secondCollection = await createKnowledgeCollection({
    collectionType: 'pattern',
    title: 'Utilization pattern',
    description: 'Governed pattern context.',
    knowledgeRecords: [records[1]._id, records[2]._id],
    ownerDomain: 'commercial_operations',
    knowledgeSteward: 'ops-steward',
    actorId: 'system',
  });

  const authoritative = await createKnowledgeAsset({
    assetType: 'operational_pattern',
    title: 'Authoritative operational pattern',
    description: 'Best governed utilization asset.',
    collections: [firstCollection._id, secondCollection._id],
    domain: 'commercial_listing',
    ownerDomain: 'commercial_operations',
    knowledgeSteward: 'ops-steward',
    quality: { level: 'authoritative', score: 99, rationale: 'Approved.', evaluatedAt: new Date() },
    lifecycle: { stage: 'reusable', enteredAt: new Date(), updatedAt: new Date(), reason: 'Reusable.' },
    actorId: 'system',
  });
  const trusted = await createKnowledgeAsset({
    assetType: 'business_pattern',
    title: 'Trusted business pattern',
    description: 'Second-ranked governed utilization asset.',
    collections: [firstCollection._id, secondCollection._id],
    domain: 'commercial_transaction',
    ownerDomain: 'commercial_operations',
    knowledgeSteward: 'ops-steward',
    quality: { level: 'trusted', score: 88, rationale: 'Trusted.', evaluatedAt: new Date() },
    lifecycle: { stage: 'approved', enteredAt: new Date(), updatedAt: new Date(), reason: 'Approved.' },
    actorId: 'system',
  });
  const candidate = await createKnowledgeAsset({
    assetType: 'operational_pattern',
    title: 'Candidate pattern',
    description: 'Excluded candidate asset.',
    collections: [firstCollection._id, secondCollection._id],
    domain: 'commercial_listing',
    ownerDomain: 'commercial_operations',
    knowledgeSteward: 'ops-steward',
    quality: { level: 'candidate', score: 40, rationale: 'Not ready.', evaluatedAt: new Date() },
    lifecycle: { stage: 'candidate', enteredAt: new Date(), updatedAt: new Date(), reason: 'Candidate.' },
    actorId: 'system',
  });

  return { records, collections: [firstCollection, secondCollection], assets: [authoritative, trusted, candidate] };
}

describe('knowledge utilization', () => {
  it('creates and validates KnowledgeConsumer and explicit Resolution Policy', async () => {
    const savedConsumer = await createKnowledgeConsumer(consumer());
    const savedPolicy = await createKnowledgeResolutionPolicy(policy());

    expect(validateKnowledgeConsumerContract(consumer())).toBe(true);
    expect(validateKnowledgeResolutionPolicy(policy())).toBe(true);
    expect(savedConsumer.consumerType).toBe('aoe');
    expect(savedPolicy.maximumPackageSize).toBe(2);
    await expect(createKnowledgeConsumer({ ...consumer(), allowedDomains: [] })).rejects.toThrow('allowed_domains_required');
    await expect(createKnowledgeResolutionPolicy({ ...policy(), maximumPackageSize: 0 })).rejects.toThrow('policy_maximum_package_size_invalid');
  });

  it('separates eligibility, selection and deterministic ranking', async () => {
    const { assets } = await seedKnowledge();
    const result = determineEligibility({ assets: assets as any, consumer: consumer(), policy: policy() });
    const ranked = rankKnowledge(result.eligible as any, consumer());
    const selected = selectKnowledge(ranked as any, policy());

    expect(result.eligible).toHaveLength(2);
    expect(result.excludedByRules).toEqual(expect.arrayContaining([expect.objectContaining({ reason: 'consumer_minimum_quality_not_met' })]));
    expect(ranked[0].quality.level).toBe('authoritative');
    expect(ranked[1].quality.level).toBe('trusted');
    expect(selected).toHaveLength(2);
    expect(rankKnowledge(result.eligible as any, consumer()).map((asset) => String(asset._id))).toEqual(
      ranked.map((asset) => String(asset._id))
    );
  });

  it('assembles immutable utilization packages, explainability and snapshots with tenantId default', async () => {
    await seedKnowledge();
    const resolved = await resolveKnowledge({
      consumer: consumer(),
      policy: policy(),
      domain: 'commercial_listing',
      objective: 'Provide governed context for AOE decision package.',
      constraints: { noInference: true },
      requestedKnowledge: { assetTypes: ['operational_pattern'] },
      actorId: 'system',
    });

    expect(resolved.package.tenantId).toBe('default');
    expect(resolved.snapshot.tenantId).toBe('default');
    expect(resolved.package.assets).toHaveLength(2);
    expect(resolved.package.records.length).toBeGreaterThan(0);
    expect(resolved.package.collections.length).toBeGreaterThan(0);
    expect(resolved.package.explainability.selectedAssets).toHaveLength(2);
    expect(resolved.package.explainability.excludedByRules).toEqual(expect.any(Array));
    expect(resolved.package).not.toHaveProperty('updatedAt');
    expect(resolved.snapshot).not.toHaveProperty('updatedAt');

    await expect(KnowledgeUtilizationPackage.findById(resolved.package._id)).resolves.toBeTruthy();
    await expect(KnowledgeSnapshot.findById(resolved.snapshot._id)).resolves.toBeTruthy();
    await expect(Audit.exists({ action: knowledgeUtilizationAuditActions.packageGenerated })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: knowledgeUtilizationAuditActions.snapshotCreated })).resolves.toBeTruthy();
  });

  it('allows AOE and Analytics to consume knowledge without creating or modifying knowledge', async () => {
    await seedKnowledge();
    const aoePackage = await utilizeKnowledge({
      consumer: consumer('aoe'),
      policy: policy(),
      domain: 'commercial_listing',
      objective: 'AOE contextual consumption only.',
      actorId: 'system',
    });
    const analyticsPackage = await resolveKnowledge({
      consumer: consumer('analytics'),
      policy: policy(),
      domain: 'commercial_transaction',
      objective: 'Analytics historical comparison context only.',
      actorId: 'system',
    });
    const observed = await observeKnowledge({ packageId: String(aoePackage.package._id), observer: 'system' });

    expect((aoePackage.package.context as any).consumer.consumerType).toBe('aoe');
    expect((analyticsPackage.package.context as any).consumer.consumerType).toBe('analytics');
    expect(observed.observed).toBe(true);
    expect(aoePackage.package).not.toHaveProperty('knowledgeCreated');
    expect(analyticsPackage.package).not.toHaveProperty('validatedKnowledge');
    await expect(Audit.exists({ action: knowledgeUtilizationAuditActions.consumed })).resolves.toBeTruthy();
  });

  it('exposes protected utilization endpoints, package access and snapshot access', async () => {
    const { header } = await auth('admin');
    const { header: userHeader } = await auth('user');
    await seedKnowledge();

    await request(app).get('/admin/knowledge/utilization').expect(401);
    await request(app).get('/admin/knowledge/utilization').set('Authorization', userHeader).expect(403);

    const resolved = await request(app)
      .post('/admin/knowledge/resolve')
      .set('Authorization', header)
      .send({
        consumer: consumer('admin'),
        policy: policy(),
        domain: 'commercial_listing',
        objective: 'Admin governed utilization.',
      })
      .expect(201);

    await request(app).get('/admin/knowledge/utilization').set('Authorization', header).expect(200)
      .expect((res) => {
        expect(res.body.totalPackages).toBe(1);
        expect(res.body.knowledgeReuseRate).toBeGreaterThan(0);
        expect(res.body.knowledgeCoverage).toBeGreaterThanOrEqual(0);
      });
    await request(app).get(`/admin/knowledge/packages/${resolved.body.package._id}`).set('Authorization', header).expect(200);
    await request(app).get(`/admin/knowledge/snapshots/${resolved.body.snapshot._id}`).set('Authorization', header).expect(200);
    await expect(Audit.exists({ action: knowledgeUtilizationAuditActions.packageAccessed })).resolves.toBeTruthy();
  });

  it('adds knowledgeUtilization to Admin Control Center', async () => {
    const { header } = await auth('super');
    await seedKnowledge();
    await resolveKnowledge({
      consumer: consumer('quality'),
      policy: policy(),
      domain: 'commercial_listing',
      objective: 'Quality context consumption.',
      actorId: 'system',
    });

    await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', header)
      .expect(200)
      .expect((res) => {
        expect(res.body.knowledgeUtilization.consumers).toBe(1);
        expect(res.body.knowledgeUtilization.packages).toBe(1);
        expect(res.body.knowledgeUtilization.snapshots).toBe(1);
        expect(res.body.knowledgeUtilization.byConsumer).toEqual(expect.any(Array));
        expect(res.body.knowledgeUtilization.byDomain).toEqual(expect.any(Array));
        expect(res.body.knowledgeUtilization.byAssetType).toEqual(expect.any(Array));
        expect(res.body.knowledgeUtilization.reuseRate).toBeGreaterThan(0);
        expect(res.body.knowledgeUtilization.coverage).toBeGreaterThanOrEqual(0);
      });
  });

  it('does not expose learning, inference, ML, AI, vector, semantic or automation surfaces', async () => {
    const { header } = await auth('admin');
    await request(app).post('/admin/knowledge/learn').set('Authorization', header).send({}).expect(404);
    await request(app).post('/admin/knowledge/infer').set('Authorization', header).send({}).expect(404);
    await request(app).post('/admin/knowledge/predict').set('Authorization', header).send({}).expect(404);
    await request(app).post('/admin/knowledge/semantic-search').set('Authorization', header).send({}).expect(404);
    await request(app).post('/admin/knowledge/automation').set('Authorization', header).send({}).expect(404);

    const resolved = await resolveKnowledge({
      consumer: consumer('admin'),
      policy: policy(),
      domain: 'commercial_listing',
      objective: 'Restriction verification.',
      actorId: 'system',
    });
    const raw = resolved.package as unknown as Record<string, unknown>;
    expect(raw).not.toHaveProperty('machineLearning');
    expect(raw).not.toHaveProperty('ai');
    expect(raw).not.toHaveProperty('embeddings');
    expect(raw).not.toHaveProperty('vectorDatabase');
    expect(raw).not.toHaveProperty('semanticSearch');
    expect(raw).not.toHaveProperty('knowledgeGraph');
    expect(raw).not.toHaveProperty('llm');
    expect(raw).not.toHaveProperty('chatbot');
    expect(raw).not.toHaveProperty('aiMemory');
    expect(raw).not.toHaveProperty('prediction');
    expect(raw).not.toHaveProperty('inferenceEngine');
    expect(raw).not.toHaveProperty('reasoningEngine');
    expect(raw).not.toHaveProperty('automation');
  });
});
