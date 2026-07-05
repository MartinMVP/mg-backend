import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { CreateKnowledgeCollectionInput, knowledgeCollectionTypes } from './knowledge.types';
import { KnowledgeRecord } from './knowledgeRecord.model';
import {
  createKnowledgeCollectionDocument,
  findKnowledgeCollectionById,
  listKnowledgeCollections as listKnowledgeCollectionDocuments,
  countKnowledgeCollections,
} from './knowledgeCollection.repository';
import { createKnowledgeRegistryEntry } from './knowledgeRegistry.repository';

export const knowledgeCollectionAuditActions = {
  created: 'KNOWLEDGE_COLLECTION_CREATED',
  updated: 'KNOWLEDGE_COLLECTION_UPDATED',
} as const;

function reject(status: number, message: string): never {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  throw error;
}

function objectId(value: string | Types.ObjectId) {
  if (!Types.ObjectId.isValid(String(value))) reject(400, 'invalid_object_id');
  return new Types.ObjectId(String(value));
}

async function audit(actor: string, action: string, payload: Record<string, unknown>) {
  await Audit.create({ actor, action, ...(payload as any) });
}

export async function createKnowledgeCollection(input: CreateKnowledgeCollectionInput & { actorId?: string }) {
  if (!knowledgeCollectionTypes.includes(input.collectionType)) reject(400, 'invalid_collection_type');
  if (!input.title || !input.description) reject(400, 'knowledge_collection_context_required');
  if (!input.ownerDomain) reject(400, 'owner_domain_required');
  if (!input.knowledgeSteward) reject(400, 'knowledge_steward_required');
  if (!Array.isArray(input.knowledgeRecords) || input.knowledgeRecords.length < 2) {
    reject(400, 'multiple_knowledge_records_required');
  }

  const knowledgeRecords = input.knowledgeRecords.map(objectId);
  const existingRecords = await KnowledgeRecord.countDocuments({ _id: { $in: knowledgeRecords } });
  if (existingRecords !== knowledgeRecords.length) reject(404, 'knowledge_record_not_found');

  const collection = await createKnowledgeCollectionDocument({
    collectionType: input.collectionType,
    title: input.title,
    description: input.description,
    knowledgeRecords,
    ownerDomain: input.ownerDomain,
    knowledgeSteward: input.knowledgeSteward,
    metadata: input.metadata || {},
  });

  await createKnowledgeRegistryEntry({
    collectionId: collection._id,
    knowledgeDomain: 'operational',
    knowledgeType: `collection:${collection.collectionType}`,
    version: 1,
    producer: collection.knowledgeSteward,
    location: { storageType: 'mongodb', reference: `KnowledgeCollection:${String(collection._id)}` },
    status: 'active',
  });

  await audit(input.actorId || 'system', knowledgeCollectionAuditActions.created, {
    collectionId: collection._id,
  });

  return collection.toObject();
}

export async function getKnowledgeCollection(id: string) {
  const collection = await findKnowledgeCollectionById(objectId(id));
  if (!collection) reject(404, 'knowledge_collection_not_found');
  return collection;
}

export async function listKnowledgeCollections(input: { page?: unknown; limit?: unknown }) {
  const page = Math.max(1, Number(input.page) || 1);
  const limit = Math.min(Math.max(1, Number(input.limit) || 50), 100);
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    listKnowledgeCollectionDocuments(skip, limit),
    countKnowledgeCollections(),
  ]);
  return { items, page, limit, total };
}
