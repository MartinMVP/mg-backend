import { Types } from 'mongoose';
import { KnowledgeRegistry, IKnowledgeRegistry } from './knowledgeRegistry.model';

export async function createKnowledgeRegistryEntry(input: Partial<IKnowledgeRegistry>) {
  return KnowledgeRegistry.create(input);
}

export async function findKnowledgeRegistryEntryByRecordId(knowledgeRecordId: Types.ObjectId) {
  return KnowledgeRegistry.findOne({ knowledgeRecordId }).lean();
}

export async function listKnowledgeRegistryEntries(skip = 0, limit = 50) {
  return KnowledgeRegistry.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
}

export async function countKnowledgeRegistryEntries() {
  return KnowledgeRegistry.countDocuments();
}
