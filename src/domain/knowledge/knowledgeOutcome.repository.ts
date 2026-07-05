import { Types } from 'mongoose';
import { IOutcomeRegistry, OutcomeRegistry } from './knowledgeOutcome.model';

export async function createOutcomeRegistryDocument(input: Partial<IOutcomeRegistry>) {
  return OutcomeRegistry.create(input);
}

export async function findOutcomeById(id: Types.ObjectId) {
  return OutcomeRegistry.findById(id).lean();
}

export async function listOutcomes(skip = 0, limit = 50) {
  return OutcomeRegistry.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
}

export async function countOutcomes() {
  return OutcomeRegistry.countDocuments();
}
