import { Schema, model, Types } from 'mongoose';

export interface IMembershipHistory {
  membershipId: Types.ObjectId;
  userId: Types.ObjectId;
  action: string;
  fromStatus?: string;
  toStatus?: string;
  actor?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const membershipHistorySchema = new Schema<IMembershipHistory>(
  {
    membershipId: { type: Schema.Types.ObjectId, ref: 'UserMembership', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: { type: String, required: true, index: true },
    fromStatus: { type: String },
    toStatus: { type: String },
    actor: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

membershipHistorySchema.index({ membershipId: 1, createdAt: -1 });

export const MembershipHistory = model<IMembershipHistory>('MembershipHistory', membershipHistorySchema);
