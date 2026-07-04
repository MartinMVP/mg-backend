import { Types } from 'mongoose';
import { AOECase, AOECaseStatus, IAOECase } from './aoeCase.model';

export function createAOECase(input: Partial<IAOECase>) {
  return AOECase.create(input);
}

export function findAOECaseById(id: Types.ObjectId) {
  return AOECase.findById(id);
}

export function listAOECases(query: Record<string, unknown>, skip: number, limit: number) {
  return AOECase.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
}

export function countAOECases(query: Record<string, unknown>) {
  return AOECase.countDocuments(query);
}

export function setAOECaseStatus(id: Types.ObjectId, status: AOECaseStatus, set: Record<string, unknown> = {}) {
  return AOECase.findByIdAndUpdate(id, { $set: { status, ...set } }, { new: true, runValidators: true });
}
