import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import {
  CreateKnowledgeAssetInput,
  KnowledgeLifecycle,
  KnowledgeQuality,
  knowledgeAssetTypes,
} from './knowledge.types';
import { KnowledgeCollection } from './knowledgeCollection.model';
import {
  createKnowledgeAssetDocument,
  findKnowledgeAssetById,
  listKnowledgeAssets as listKnowledgeAssetDocuments,
  countKnowledgeAssets,
} from './knowledgeAsset.repository';
import { createKnowledgeRegistryEntry } from './knowledgeRegistry.repository';

export const knowledgeAssetAuditActions = {
  created: 'KNOWLEDGE_ASSET_CREATED',
  updated: 'KNOWLEDGE_ASSET_UPDATED',
  qualityUpdated: 'KNOWLEDGE_QUALITY_UPDATED',
  lifecycleChanged: 'KNOWLEDGE_LIFECYCLE_CHANGED',
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

function defaultQuality(input?: KnowledgeQuality): KnowledgeQuality {
  return input || {
    level: 'candidate',
    score: 50,
    rationale: 'Initial governed asset quality.',
    evaluatedAt: new Date(),
  };
}

function defaultLifecycle(input?: KnowledgeLifecycle): KnowledgeLifecycle {
  const now = new Date();
  return input || {
    stage: 'candidate',
    enteredAt: now,
    updatedAt: now,
    reason: 'Initial governed asset lifecycle.',
  };
}

export async function createKnowledgeAsset(input: CreateKnowledgeAssetInput & { actorId?: string }) {
  if (!knowledgeAssetTypes.includes(input.assetType)) reject(400, 'invalid_asset_type');
  if (!input.title || !input.description) reject(400, 'knowledge_asset_context_required');
  if (!input.ownerDomain) reject(400, 'owner_domain_required');
  if (!input.knowledgeSteward) reject(400, 'knowledge_steward_required');
  if (!Array.isArray(input.collections) || input.collections.length < 2) reject(400, 'multiple_collections_required');

  const collections = input.collections.map(objectId);
  const existingCollections = await KnowledgeCollection.countDocuments({ _id: { $in: collections } });
  if (existingCollections !== collections.length) reject(404, 'knowledge_collection_not_found');

  const quality = defaultQuality(input.quality);
  const lifecycle = defaultLifecycle(input.lifecycle);
  const asset = await createKnowledgeAssetDocument({
    tenantId: input.tenantId || 'default',
    assetType: input.assetType,
    title: input.title,
    description: input.description,
    collections,
    domain: input.domain,
    ownerDomain: input.ownerDomain,
    knowledgeSteward: input.knowledgeSteward,
    quality,
    lifecycle,
    version: input.version || 1,
  });

  await createKnowledgeRegistryEntry({
    assetId: asset._id,
    knowledgeDomain: 'operational',
    knowledgeType: `asset:${asset.assetType}`,
    version: asset.version,
    producer: asset.knowledgeSteward,
    location: { storageType: 'mongodb', reference: `KnowledgeAsset:${String(asset._id)}` },
    quality,
    lifecycle,
    status: lifecycle.stage === 'archived' ? 'archived' : lifecycle.stage === 'deprecated' ? 'deprecated' : 'active',
  });

  await audit(input.actorId || 'system', knowledgeAssetAuditActions.created, { assetId: asset._id });
  await audit(input.actorId || 'system', knowledgeAssetAuditActions.qualityUpdated, { assetId: asset._id });
  await audit(input.actorId || 'system', knowledgeAssetAuditActions.lifecycleChanged, { assetId: asset._id });

  return asset.toObject();
}

export async function getKnowledgeAsset(id: string) {
  const asset = await findKnowledgeAssetById(objectId(id));
  if (!asset) reject(404, 'knowledge_asset_not_found');
  return asset;
}

export async function listKnowledgeAssets(input: { page?: unknown; limit?: unknown }) {
  const page = Math.max(1, Number(input.page) || 1);
  const limit = Math.min(Math.max(1, Number(input.limit) || 50), 100);
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    listKnowledgeAssetDocuments(skip, limit),
    countKnowledgeAssets(),
  ]);
  return { items, page, limit, total };
}
