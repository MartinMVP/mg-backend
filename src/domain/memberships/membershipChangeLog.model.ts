import { Schema, model, Types } from 'mongoose';

export const membershipChangeTypes = [
  'upgrade_requested',
  'upgrade_completed',
  'downgrade_requested',
  'downgrade_scheduled',
  'downgrade_completed',
  'cancellation_requested',
  'cancellation_scheduled',
  'cancellation_completed',
  'reactivation_requested',
  'reactivation_completed',
  'admin_adjustment',
] as const;

export type MembershipChangeType = typeof membershipChangeTypes[number];
export type MembershipChangeSource = 'user' | 'admin' | 'stripe' | 'system';

export interface IMembershipChangeLog {
  userId: Types.ObjectId;
  userMembershipId: Types.ObjectId;
  fromPlanId?: Types.ObjectId;
  toPlanId?: Types.ObjectId;
  changeType: MembershipChangeType;
  effectiveAt?: Date;
  source: MembershipChangeSource;
  reason?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const membershipChangeLogSchema = new Schema<IMembershipChangeLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userMembershipId: { type: Schema.Types.ObjectId, ref: 'UserMembership', required: true, index: true },
    fromPlanId: { type: Schema.Types.ObjectId, ref: 'MembershipPlan' },
    toPlanId: { type: Schema.Types.ObjectId, ref: 'MembershipPlan' },
    changeType: { type: String, enum: membershipChangeTypes, required: true, index: true },
    effectiveAt: { type: Date, index: true },
    source: { type: String, enum: ['user', 'admin', 'stripe', 'system'], required: true, index: true },
    reason: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

membershipChangeLogSchema.index({ userId: 1, createdAt: -1 });
membershipChangeLogSchema.index({ userMembershipId: 1, createdAt: -1 });

export const MembershipChangeLog = model<IMembershipChangeLog>('MembershipChangeLog', membershipChangeLogSchema);
