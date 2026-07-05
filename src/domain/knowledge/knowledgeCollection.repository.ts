import { Types } from 'mongoose';
import { KnowledgeCollection, IKnowledgeCollection } from './knowledgeCollection.model';

export async function createKnowledgeCollectionDocument(input: Partial<IKnowledgeCollection>) {
  return KnowledgeCollection.create(input);
}

export async function findKnowledgeCollectionById(id: Types.ObjectId) {
  return KnowledgeCollection.findById(id).lean();
}

export async function listKnowledgeCollections(skip = 0, limit = 50) {
  return KnowledgeCollection.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
}

export async function countKnowledgeCollections() {
  return KnowledgeCollection.countDocuments();
}
