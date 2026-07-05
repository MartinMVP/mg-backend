import { Types } from 'mongoose';
import {
  AOEOperationalDecisionPackage,
  IAOEOperationalDecisionPackage,
} from './aoeOperationalDecision.model';
import { AOEOperationalDecisionStatus } from './aoeDecision.types';

export async function createAOEOperationalDecisionPackage(input: Partial<IAOEOperationalDecisionPackage>) {
  return AOEOperationalDecisionPackage.create(input);
}

export async function findAOEOperationalDecisionPackageById(id: Types.ObjectId) {
  return AOEOperationalDecisionPackage.findById(id).lean();
}

export async function findLatestAOEOperationalDecisionForCase(aoeCaseId: Types.ObjectId) {
  return AOEOperationalDecisionPackage.findOne({ aoeCaseId }).sort({ createdAt: -1 }).lean();
}

export async function listAOEOperationalDecisionPackages(skip = 0, limit = 50) {
  return AOEOperationalDecisionPackage.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
}

export async function countAOEOperationalDecisionPackages() {
  return AOEOperationalDecisionPackage.countDocuments();
}

export async function setAOEOperationalDecisionStatus(id: Types.ObjectId, status: AOEOperationalDecisionStatus) {
  return AOEOperationalDecisionPackage.findByIdAndUpdate(
    id,
    { $set: { status } },
    { new: true, runValidators: true }
  );
}
