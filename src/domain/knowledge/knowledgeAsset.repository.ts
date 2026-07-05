import { Types } from 'mongoose';
import { KnowledgeAsset, IKnowledgeAsset } from './knowledgeAsset.model';

export async function createKnowledgeAssetDocument(input: Partial<IKnowledgeAsset>) {
  return KnowledgeAsset.create(input);
}

export async function findKnowledgeAssetById(id: Types.ObjectId) {
  return KnowledgeAsset.findById(id).lean();
}

export async function listKnowledgeAssets(skip = 0, limit = 50) {
  return KnowledgeAsset.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
}

export async function countKnowledgeAssets() {
  return KnowledgeAsset.countDocuments();
}
