import { FilterQuery, Types } from 'mongoose';
import { KnowledgeRecord, IKnowledgeRecord } from './knowledgeRecord.model';

export async function createKnowledgeRecordDocument(input: Partial<IKnowledgeRecord>) {
  return KnowledgeRecord.create(input);
}

export async function findKnowledgeRecordById(id: Types.ObjectId) {
  return KnowledgeRecord.findById(id).lean();
}

export async function listKnowledgeRecords(filter: FilterQuery<IKnowledgeRecord>, skip = 0, limit = 50) {
  return KnowledgeRecord.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
}

export async function countKnowledgeRecords(filter: FilterQuery<IKnowledgeRecord>) {
  return KnowledgeRecord.countDocuments(filter);
}
