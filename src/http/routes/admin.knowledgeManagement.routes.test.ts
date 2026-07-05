import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { User } from '../../domain/users/user.model';
import { signAccessToken } from '../../utils/jwt';
import { createKnowledgeAsset, knowledgeAssetAuditActions } from '../../domain/knowledge/knowledgeAsset.service';
import { KnowledgeRegistry } from '../../domain/knowledge/knowledgeRegistry.model';
import { createKnowledgeRecord } from '../../domain/knowledge/knowledgeRecord.service';
import {
  organizeKnowledge,
  curateKnowledge,
  reviewKnowledge,
} from '../../domain/knowledge/knowledgePreservation.service';
import { knowledgeCollectionAuditActions } from '../../domain/knowledge/knowledgeCollection.service';

async function auth(role: 'user' | 'admin' | 'super' = 'admin') {
  const user = await User.create({
    name: `${role} knowledge manager`,
    email: `${role}-${new Types.ObjectId()}@knowledge.local`,
    password: 'secret123',
    role,
  });
  return {
    user,
    header: `Bearer ${signAccessToken({ sub: String(user._id), role, typ: 'access' })}`,
  };
}

function recordPayload(index: number, knowledgeDomain = 'commercial_listing') {
  return {
    knowledgeDomain,
    knowledgeType: 'managed_observation',
    sourceType: 'manual',
    sourceId: String(new Types.ObjectId()),
    facts: { index, state: 'observed' },
    context: { sprint: '10.9.2' },
    provenance: {
      generatedBy: 'manual',
      sourceEvidence: [
        {
          sourceType: 'manual',
          sourceId: String(new Types.ObjectId()),
          description: `Manual evidence ${index}`,
        },
      ],
      rulesVersion: 'GCD-11',
      engineVersion: null,
      validatedBy: null,
      approvedBy: null,
      validatedAt: null,
      approvedAt: null,
    },
    producer: 'knowledge-management-test',
    actorId: 'system',
  };
}

async function seedRecords() {
  const first = await createKnowledgeRecord(recordPayload(1) as any);
  const second = await createKnowledgeRecord(recordPayload(2) as any);
  const third = await createKnowledgeRecord(recordPayload(3, 'commercial_transaction') as any);
  return [first, second, third];
}

async function seedCollections(actorId = 'system') {
  const [first, second, third] = await seedRecords();
  const collectionOne = await organizeKnowledge({
    collectionType: 'case',
    title: 'Closed listing case context',
    description: 'Governed context built from related listing records, not a filesystem folder.',
    knowledgeRecords: [first._id, second._id],
    ownerDomain: 'commercial_operations',
    knowledgeSteward: 'ops-steward',
    metadata: { contextKind: 'case_context' },
    actorId,
  });
  const collectionTwo = await organizeKnowledge({
    collectionType: 'operational_history',
    title: 'Commercial transaction history',
    description: 'Governed operational history context across records.',
    knowledgeRecords: [second._id, third._id],
    ownerDomain: 'commercial_operations',
    knowledgeSteward: 'ops-steward',
    metadata: { contextKind: 'history_context' },
    actorId,
  });
  return { records: [first, second, third], collections: [collectionOne, collectionTwo] };
}

describe('admin knowledge management', () => {
  it('creates KnowledgeCollection as governed context with multiple records, owner domain and stewardship', async () => {
    const { header } = await auth('admin');
    const [first, second] = await seedRecords();

    const response = await request(app)
      .post('/admin/knowledge/collections')
      .set('Authorization', header)
      .send({
        collectionType: 'case',
        title: 'Listing dispute context',
        description: 'Governed case context assembled from operational records.',
        knowledgeRecords: [first._id, second._id],
        ownerDomain: 'commercial_operations',
        knowledgeSteward: 'knowledge-steward-a',
        metadata: { folder: false, context: 'case' },
      })
      .expect(201);

    expect(response.body.collectionType).toBe('case');
    expect(response.body.description).toContain('context');
    expect(response.body.metadata.folder).toBe(false);
    expect(response.body.knowledgeRecords).toHaveLength(2);
    expect(response.body.ownerDomain).toBe('commercial_operations');
    expect(response.body.knowledgeSteward).toBe('knowledge-steward-a');

    const registry = await KnowledgeRegistry.findOne({ collectionId: response.body._id }).lean();
    expect(registry?.status).toBe('active');
    expect(String(registry?.collectionId)).toBe(response.body._id);
    await expect(Audit.exists({ action: knowledgeCollectionAuditActions.created })).resolves.toBeTruthy();
  });

  it('creates KnowledgeAsset only through service with collections, quality, lifecycle and stewardship', async () => {
    const { collections } = await seedCollections();
    const asset = await createKnowledgeAsset({
      assetType: 'operational_pattern',
      title: 'Operational closure pattern',
      description: 'Governed asset composed from multiple knowledge collections.',
      collections: collections.map((collection) => collection._id),
      domain: 'commercial_operations',
      ownerDomain: 'commercial_operations',
      knowledgeSteward: 'ops-steward',
      quality: {
        level: 'trusted',
        score: 91,
        rationale: 'Validated by operational review.',
        evaluatedAt: new Date(),
      },
      lifecycle: {
        stage: 'deprecated',
        enteredAt: new Date(),
        updatedAt: new Date(),
        reason: 'Superseded but still trusted as historical evidence.',
      },
      actorId: 'system',
    });

    expect(asset.collections).toHaveLength(2);
    expect(asset.ownerDomain).toBe('commercial_operations');
    expect(asset.knowledgeSteward).toBe('ops-steward');
    expect(asset.quality.level).toBe('trusted');
    expect(asset.lifecycle.stage).toBe('deprecated');
    expect(asset.quality.level).not.toBe(asset.lifecycle.stage);

    const registry = await KnowledgeRegistry.findOne({ assetId: asset._id }).lean();
    expect(registry?.assetId?.toString()).toBe(String(asset._id));
    expect(registry?.quality?.level).toBe('trusted');
    expect(registry?.lifecycle?.stage).toBe('deprecated');
    expect(registry?.status).toBe('deprecated');
    await expect(Audit.exists({ action: knowledgeAssetAuditActions.created })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: knowledgeAssetAuditActions.qualityUpdated })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: knowledgeAssetAuditActions.lifecycleChanged })).resolves.toBeTruthy();
  });

  it('reports coverage and freshness metrics through protected endpoints', async () => {
    const { header } = await auth('super');
    const { collections } = await seedCollections();
    await createKnowledgeAsset({
      assetType: 'business_pattern',
      title: 'Business evidence pattern',
      description: 'Governed business asset.',
      collections: collections.map((collection) => collection._id),
      domain: 'commercial_operations',
      ownerDomain: 'commercial_operations',
      knowledgeSteward: 'ops-steward',
      quality: { level: 'authoritative', score: 97, rationale: 'Approved governance source.', evaluatedAt: new Date() },
      lifecycle: { stage: 'reusable', enteredAt: new Date(), updatedAt: new Date(), reason: 'Approved for future reuse stage.' },
      actorId: 'system',
    });

    await request(app)
      .get('/admin/knowledge/metrics')
      .set('Authorization', header)
      .expect(200)
      .expect((res) => {
        expect(res.body.totalRecords).toBe(3);
        expect(res.body.totalCollections).toBe(2);
        expect(res.body.totalAssets).toBe(1);
        expect(res.body.coverage).toEqual(
          expect.arrayContaining([expect.objectContaining({ domain: 'commercial_listing', percentage: expect.any(Number) })])
        );
        expect(res.body.freshness.percentage).toBeGreaterThan(0);
        expect(res.body.authoritativeKnowledge).toBe(1);
        expect(res.body.reusableKnowledge).toBe(1);
      });
  });

  it('PKPP organizes, curates and reviews without learning, prediction or automation', async () => {
    const { collections } = await seedCollections();
    const curated = await curateKnowledge({
      assetType: 'platform_pattern',
      title: 'Platform governance pattern',
      description: 'Curated governed asset.',
      collections: collections.map((collection) => collection._id),
      domain: 'platform',
      ownerDomain: 'platform_core',
      knowledgeSteward: 'platform-steward',
      actorId: 'system',
    });
    const review = await reviewKnowledge({
      subjectId: String(curated._id),
      subjectType: 'asset',
      reviewer: 'admin-reviewer',
      notes: 'Reviewed for management readiness.',
    });

    expect(curated.assetType).toBe('platform_pattern');
    expect(review.reviewed).toBe(true);

    const raw = curated as unknown as Record<string, unknown>;
    expect(raw).not.toHaveProperty('learn');
    expect(raw).not.toHaveProperty('predict');
    expect(raw).not.toHaveProperty('optimize');
    expect(raw).not.toHaveProperty('automate');
    expect(raw).not.toHaveProperty('reuseEngine');
    expect(raw).not.toHaveProperty('aoeConsumption');
  });

  it('protects endpoints, exposes read-only assets and does not expose asset POST or advanced intelligence surfaces', async () => {
    const { header } = await auth('admin');
    const { header: userHeader } = await auth('user');
    const { collections } = await seedCollections();
    const asset = await createKnowledgeAsset({
      assetType: 'engineering_pattern',
      title: 'Engineering governance pattern',
      description: 'Governed engineering asset.',
      collections: collections.map((collection) => collection._id),
      domain: 'engineering',
      ownerDomain: 'platform_core',
      knowledgeSteward: 'engineering-steward',
      actorId: 'system',
    });

    await request(app).get('/admin/knowledge/collections').expect(401);
    await request(app).get('/admin/knowledge/collections').set('Authorization', userHeader).expect(403);

    await request(app).get('/admin/knowledge/collections').set('Authorization', header).expect(200);
    await request(app).get(`/admin/knowledge/collections/${collections[0]._id}`).set('Authorization', header).expect(200);
    await request(app).get('/admin/knowledge/assets').set('Authorization', header).expect(200);
    await request(app).get(`/admin/knowledge/assets/${asset._id}`).set('Authorization', header).expect(200);
    await request(app).post('/admin/knowledge/assets').set('Authorization', header).send({}).expect(404);
    await request(app).post('/admin/knowledge/reuse').set('Authorization', header).send({}).expect(404);
    await request(app).post('/admin/knowledge/aoe-consumption').set('Authorization', header).send({}).expect(404);
    await request(app).post('/admin/knowledge/semantic-search').set('Authorization', header).send({}).expect(404);
    await request(app).post('/admin/knowledge/automation').set('Authorization', header).send({}).expect(404);
  });

  it('adds knowledgeManagement to Admin Control Center', async () => {
    const { header } = await auth('super');
    const { collections } = await seedCollections();
    await createKnowledgeAsset({
      assetType: 'compliance_pattern',
      title: 'Compliance evidence pattern',
      description: 'Governed compliance asset.',
      collections: collections.map((collection) => collection._id),
      domain: 'compliance',
      ownerDomain: 'compliance',
      knowledgeSteward: 'compliance-steward',
      quality: { level: 'authoritative', score: 99, rationale: 'Governance approved.', evaluatedAt: new Date() },
      lifecycle: { stage: 'reusable', enteredAt: new Date(), updatedAt: new Date(), reason: 'Approved.' },
      actorId: 'system',
    });

    await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', header)
      .expect(200)
      .expect((res) => {
        expect(res.body.knowledgeManagement.records).toBe(3);
        expect(res.body.knowledgeManagement.collections).toBe(2);
        expect(res.body.knowledgeManagement.assets).toBe(1);
        expect(res.body.knowledgeManagement.byDomain).toEqual(expect.any(Array));
        expect(res.body.knowledgeManagement.byQuality).toEqual(expect.any(Array));
        expect(res.body.knowledgeManagement.byLifecycle).toEqual(expect.any(Array));
        expect(res.body.knowledgeManagement.authoritative).toBe(1);
        expect(res.body.knowledgeManagement.coverage).toEqual(expect.any(Array));
        expect(res.body.knowledgeManagement.freshness.percentage).toBeGreaterThan(0);
      });
  });
});
