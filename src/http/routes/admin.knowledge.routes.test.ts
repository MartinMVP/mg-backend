import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { User } from '../../domain/users/user.model';
import { signAccessToken } from '../../utils/jwt';
import { KnowledgeRecord } from '../../domain/knowledge/knowledgeRecord.model';
import { KnowledgeRegistry } from '../../domain/knowledge/knowledgeRegistry.model';
import {
  createKnowledgeRecord,
  createKnowledgeRecordVersion,
  knowledgeRecordAuditActions,
} from '../../domain/knowledge/knowledgeRecord.service';
import {
  captureKnowledgeRecord,
  classifyKnowledgeRecord,
  versionKnowledgeRecord,
} from '../../domain/knowledge/knowledgePreservation.service';
import * as knowledgeRecordRepository from '../../domain/knowledge/knowledgeRecord.repository';

async function auth(role: 'user' | 'admin' | 'super' = 'admin') {
  const user = await User.create({
    name: `${role} user`,
    email: `${role}-${new Types.ObjectId()}@test.local`,
    password: 'secret123',
    role,
  });
  return {
    user,
    header: `Bearer ${signAccessToken({ sub: String(user._id), role, typ: 'access' })}`,
  };
}

function knowledgePayload(overrides: Record<string, unknown> = {}) {
  return {
    knowledgeDomain: 'commercial_listing',
    knowledgeType: 'listing_status_observation',
    sourceType: 'audit',
    sourceId: String(new Types.ObjectId()),
    facts: { status: 'published', listingId: String(new Types.ObjectId()) },
    context: { channel: 'admin_validation' },
    provenance: {
      generatedBy: 'system',
      sourceEvidence: [
        {
          sourceType: 'audit',
          sourceId: String(new Types.ObjectId()),
          description: 'Audit event observed during operational validation.',
        },
      ],
      rulesVersion: 'GCD-11',
      engineVersion: null,
      validatedBy: null,
      approvedBy: null,
      validatedAt: null,
      approvedAt: null,
    },
    producer: 'pkpp',
    ...overrides,
  };
}

describe('admin knowledge foundation routes', () => {
  it('creates immutable KnowledgeRecord documents with provenance and registry entries', async () => {
    const { header } = await auth('admin');

    const response = await request(app)
      .post('/admin/knowledge/records')
      .set('Authorization', header)
      .send(knowledgePayload())
      .expect(201);

    expect(response.body.knowledgeDomain).toBe('commercial_listing');
    expect(response.body.knowledgeType).toBe('listing_status_observation');
    expect(response.body.version).toBe(1);
    expect(response.body.provenance.generatedBy).toBe('system');
    expect(response.body.provenance.sourceEvidence).toHaveLength(1);

    await expect(KnowledgeRegistry.exists({ knowledgeRecordId: response.body._id })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: knowledgeRecordAuditActions.created })).resolves.toBeTruthy();
  });

  it('keeps repositories append-only and does not expose update or delete operations', () => {
    expect(knowledgeRecordRepository).toHaveProperty('createKnowledgeRecordDocument');
    expect(knowledgeRecordRepository).toHaveProperty('findKnowledgeRecordById');
    expect(knowledgeRecordRepository).toHaveProperty('listKnowledgeRecords');
    expect(knowledgeRecordRepository).toHaveProperty('countKnowledgeRecords');
    expect(knowledgeRecordRepository).not.toHaveProperty('updateKnowledgeRecord');
    expect(knowledgeRecordRepository).not.toHaveProperty('deleteKnowledgeRecord');
    expect(knowledgeRecordRepository).not.toHaveProperty('removeKnowledgeRecord');
  });

  it('creates new versions without changing the previous record', async () => {
    const original = await createKnowledgeRecord(knowledgePayload({ actorId: 'system' }) as any);

    const versioned = await createKnowledgeRecordVersion({
      previousRecordId: String(original._id),
      actorId: 'system',
      changes: {
        facts: { status: 'archived', listingId: original.facts.listingId },
        context: { channel: 'admin_validation', reason: 'new_evidence' },
      },
    });

    const unchangedOriginal = await KnowledgeRecord.findById(original._id).lean();

    expect(versioned._id).not.toEqual(original._id);
    expect(versioned.version).toBe(2);
    expect(versioned.facts.status).toBe('archived');
    expect(unchangedOriginal?.version).toBe(1);
    expect(unchangedOriginal?.facts.status).toBe('published');
    await expect(KnowledgeRegistry.exists({ knowledgeRecordId: versioned._id })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: knowledgeRecordAuditActions.versioned })).resolves.toBeTruthy();
  });

  it('keeps Knowledge Context Isolation on commercial_listing and commercial_transaction names', async () => {
    const listing = await classifyKnowledgeRecord({ knowledgeDomain: 'commercial_listing' });
    const transaction = await classifyKnowledgeRecord({ knowledgeDomain: 'commercial_transaction' });

    expect(listing.contextIsolated).toBe(true);
    expect(transaction.contextIsolated).toBe(true);

    await expect(
      createKnowledgeRecord(knowledgePayload({ knowledgeDomain: 'marketplace' }) as any)
    ).rejects.toThrow('invalid_knowledge_domain');
    await expect(
      createKnowledgeRecord(knowledgePayload({ knowledgeDomain: 'auction' }) as any)
    ).rejects.toThrow('invalid_knowledge_domain');
  });

  it('PKPP captures, preserves and versions knowledge without learning or automation', async () => {
    const captured = await captureKnowledgeRecord(knowledgePayload({ actorId: 'system' }) as any);
    const versioned = await versionKnowledgeRecord(
      String(captured._id),
      { facts: { preserved: true }, producer: 'pkpp' },
      'system'
    );

    expect(captured.version).toBe(1);
    expect(versioned.version).toBe(2);

    const raw = versioned as unknown as Record<string, unknown>;
    expect(raw).not.toHaveProperty('learn');
    expect(raw).not.toHaveProperty('predict');
    expect(raw).not.toHaveProperty('optimize');
    expect(raw).not.toHaveProperty('automate');
  });

  it('protects admin endpoints and supports list/detail/registry/version flows', async () => {
    const { header } = await auth('admin');
    const { header: userHeader } = await auth('user');

    await request(app).get('/admin/knowledge/records').expect(401);
    await request(app).get('/admin/knowledge/records').set('Authorization', userHeader).expect(403);

    const created = await request(app)
      .post('/admin/knowledge/records')
      .set('Authorization', header)
      .send(knowledgePayload())
      .expect(201);

    await request(app)
      .get('/admin/knowledge/records?knowledgeDomain=commercial_listing&limit=10&page=1')
      .set('Authorization', header)
      .expect(200)
      .expect((res) => {
        expect(res.body.total).toBe(1);
        expect(res.body.items[0]._id).toBe(created.body._id);
      });

    await request(app)
      .get(`/admin/knowledge/records/${created.body._id}`)
      .set('Authorization', header)
      .expect(200);

    await request(app)
      .get('/admin/knowledge/registry')
      .set('Authorization', header)
      .expect(200)
      .expect((res) => {
        expect(res.body.total).toBe(1);
        expect(res.body.items[0].location.storageType).toBe('mongodb');
      });

    await request(app)
      .post(`/admin/knowledge/records/${created.body._id}/version`)
      .set('Authorization', header)
      .send({ changes: { facts: { status: 'reviewed' } } })
      .expect(201)
      .expect((res) => {
        expect(res.body.version).toBe(2);
      });
  });

  it('adds minimal knowledgeFoundation metrics to Admin Control Center', async () => {
    const { header } = await auth('super');
    const original = await createKnowledgeRecord(knowledgePayload({ actorId: 'system' }) as any);
    await createKnowledgeRecordVersion({
      previousRecordId: String(original._id),
      actorId: 'system',
      changes: { facts: { status: 'versioned' } },
    });

    await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', header)
      .expect(200)
      .expect((res) => {
        expect(res.body.knowledgeFoundation.totalRecords).toBe(2);
        expect(res.body.knowledgeFoundation.totalRegistryEntries).toBe(2);
        expect(res.body.knowledgeFoundation.recordsByDomain).toEqual(
          expect.arrayContaining([expect.objectContaining({ domain: 'commercial_listing', count: 2 })])
        );
        expect(res.body.knowledgeFoundation.recordsBySourceType).toEqual(
          expect.arrayContaining([expect.objectContaining({ sourceType: 'audit', count: 2 })])
        );
        expect(res.body.knowledgeFoundation.latestVersionedRecords[0].version).toBe(2);
      });
  });

  it('does not implement Knowledge Asset, Collections, advanced query, AOE integration or AI surfaces', async () => {
    const { header } = await auth('admin');

    await request(app).get('/admin/knowledge/assets').set('Authorization', header).expect(200);
    await request(app).post('/admin/knowledge/assets').set('Authorization', header).send({}).expect(404);
    await request(app).get('/admin/knowledge/collections').set('Authorization', header).expect(200);
    await request(app).post('/admin/knowledge/query').set('Authorization', header).send({}).expect(404);

    const created = await createKnowledgeRecord(knowledgePayload({ actorId: 'system' }) as any);
    const raw = JSON.parse(JSON.stringify(created));

    expect(raw).not.toHaveProperty('quality');
    expect(raw).not.toHaveProperty('lifecycle');
    expect(raw).not.toHaveProperty('aoeConsumption');
    expect(raw).not.toHaveProperty('machineLearning');
    expect(raw).not.toHaveProperty('reinforcementLearning');
    expect(raw).not.toHaveProperty('autoLearning');
    expect(raw).not.toHaveProperty('semanticSearch');
    expect(raw).not.toHaveProperty('vectorDatabase');
    expect(raw).not.toHaveProperty('embeddings');
    expect(raw).not.toHaveProperty('knowledgeGraph');
    expect(raw).not.toHaveProperty('llm');
    expect(raw).not.toHaveProperty('chatbot');
    expect(raw).not.toHaveProperty('aiMemory');
    expect(raw).not.toHaveProperty('reasoningEngine');
    expect(raw).not.toHaveProperty('automation');
    expect(raw).not.toHaveProperty('autonomy');
  });
});
