import { Schema, model, Types } from 'mongoose';

export const membershipStatuses = [
  'draft',
  'pending_activation',
  'pending_payment',
  'active',
  'payment_failed',
  'in_dunning',
  'grace_period',
  'suspended',
  'cancelled',
  'expired',
] as const;

export type MembershipStatus = typeof membershipStatuses[number];
export const operationallyActiveMembershipStatuses: MembershipStatus[] = ['active', 'grace_period', 'in_dunning'];

export type MembershipRenewalMode = 'automatic' | 'manual';
export type MembershipSource = 'admin' | 'stripe' | 'manual' | 'migration';
export type MembershipPaymentProvider = 'stripe' | 'manual' | 'none';
export type MembershipPendingChangeType = 'upgrade' | 'downgrade' | 'reactivation' | 'cancellation';

export interface IUserMembership {
  userId: Types.ObjectId;
  planId: Types.ObjectId;
  status: MembershipStatus;
  startsAt: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  renewalMode: MembershipRenewalMode;
  source: MembershipSource;
  paymentProvider?: MembershipPaymentProvider;
  providerCustomerId?: string;
  providerSubscriptionId?: string;
  lastPaymentAt?: Date;
  nextBillingAt?: Date;
  graceEndsAt?: Date;
  suspendedAt?: Date;
  cancelledAt?: Date;
  expiresAt?: Date;
  activatedAt?: Date;
  metadata?: Record<string, unknown>;
  cancelAtPeriodEnd?: boolean;
  cancelScheduledAt?: Date;
  cancelReason?: string;
  pendingPlanId?: Types.ObjectId;
  pendingChangeType?: MembershipPendingChangeType;
  pendingChangeEffectiveAt?: Date;
  changedFromPlanId?: Types.ObjectId;
  changedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userMembershipSchema = new Schema<IUserMembership>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    planId: { type: Schema.Types.ObjectId, ref: 'MembershipPlan', required: true },
    status: { type: String, enum: membershipStatuses, default: 'pending_activation', index: true },
    startsAt: { type: Date, required: true },
    currentPeriodStart: { type: Date, required: true },
    currentPeriodEnd: { type: Date, required: true },
    renewalMode: { type: String, enum: ['automatic', 'manual'], default: 'manual' },
    source: { type: String, enum: ['admin', 'stripe', 'manual', 'migration'], required: true },
    paymentProvider: { type: String, enum: ['stripe', 'manual', 'none'], default: 'none' },
    providerCustomerId: String,
    providerSubscriptionId: { type: String, index: true, sparse: true },
    lastPaymentAt: Date,
    nextBillingAt: Date,
    graceEndsAt: Date,
    suspendedAt: Date,
    cancelledAt: Date,
    expiresAt: Date,
    activatedAt: Date,
    metadata: { type: Schema.Types.Mixed },
    cancelAtPeriodEnd: { type: Boolean, default: false, index: true },
    cancelScheduledAt: Date,
    cancelReason: { type: String, trim: true },
    pendingPlanId: { type: Schema.Types.ObjectId, ref: 'MembershipPlan' },
    pendingChangeType: { type: String, enum: ['upgrade', 'downgrade', 'reactivation', 'cancellation'] },
    pendingChangeEffectiveAt: { type: Date, index: true },
    changedFromPlanId: { type: Schema.Types.ObjectId, ref: 'MembershipPlan' },
    changedAt: Date,
  },
  { timestamps: true }
);

userMembershipSchema.index({ userId: 1, status: 1 });
userMembershipSchema.index({ userId: 1, currentPeriodEnd: 1 });
userMembershipSchema.index({ pendingChangeEffectiveAt: 1, pendingChangeType: 1 });
userMembershipSchema.index(
  { userId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: operationallyActiveMembershipStatuses },
    },
  }
);

export const UserMembership = model<IUserMembership>('UserMembership', userMembershipSchema);


