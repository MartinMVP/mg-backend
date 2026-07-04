import { Schema, model, Types } from 'mongoose';

export const aoeCaseTypes = [
  'auction_default',
  'sanction_review',
  'appeal_review',
  'fraud_signal',
  'operational_alert',
  'membership_signal',
  'revenue_signal',
  'messaging_signal',
  'marketplace_signal',
] as const;
export type AOECaseType = typeof aoeCaseTypes[number];

export const aoeCaseStatuses = ['open', 'collecting_evidence', 'proposal_generated', 'escalated', 'closed'] as const;
export type AOECaseStatus = typeof aoeCaseStatuses[number];

export const aoeCasePriorities = ['low', 'medium', 'high', 'critical'] as const;
export type AOECasePriority = typeof aoeCasePriorities[number];

export const aoeEntityTypes = [
  'auction',
  'sanction',
  'appeal',
  'conversation',
  'user',
  'membership',
  'payment',
  'listing',
  'platform',
] as const;
export type AOEEntityType = typeof aoeEntityTypes[number];

export const aoeCaseCreatedBy = ['system', 'admin'] as const;
export type AOECaseCreatedBy = typeof aoeCaseCreatedBy[number];

export interface IAOECase {
  type: AOECaseType;
  status: AOECaseStatus;
  priority: AOECasePriority;
  entityType: AOEEntityType;
  entityId: Types.ObjectId;
  createdBy: AOECaseCreatedBy;
  assignedAdmin?: Types.ObjectId;
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const aoeCaseSchema = new Schema<IAOECase>(
  {
    type: { type: String, enum: aoeCaseTypes, required: true, index: true },
    status: { type: String, enum: aoeCaseStatuses, default: 'open', index: true },
    priority: { type: String, enum: aoeCasePriorities, default: 'medium', index: true },
    entityType: { type: String, enum: aoeEntityTypes, required: true, index: true },
    entityId: { type: Schema.Types.ObjectId, required: true, index: true },
    createdBy: { type: String, enum: aoeCaseCreatedBy, default: 'system', index: true },
    assignedAdmin: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    closedAt: { type: Date },
  },
  { timestamps: true }
);

aoeCaseSchema.index({ entityType: 1, entityId: 1, type: 1, createdAt: -1 });
aoeCaseSchema.index({ createdAt: -1 });

export const AOECase = model<IAOECase>('AOECase', aoeCaseSchema);
