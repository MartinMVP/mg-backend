import { Types } from 'mongoose';
import { IKnowledgeValidation, KnowledgeValidation } from './knowledgeValidation.model';

export async function createKnowledgeValidationDocument(input: Partial<IKnowledgeValidation>) {
  return KnowledgeValidation.create(input);
}

export async function findKnowledgeValidationById(id: Types.ObjectId) {
  return KnowledgeValidation.findById(id).lean();
}

export async function listKnowledgeValidations(skip = 0, limit = 50) {
  return KnowledgeValidation.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
}

export async function countKnowledgeValidations() {
  return KnowledgeValidation.countDocuments();
}
