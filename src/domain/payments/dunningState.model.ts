import { Schema, model, Types } from 'mongoose';

export type DunningStatus = 'none' | 'active' | 'recovered' | 'suspended' | 'cancelled';
export type DunningRetryDay = 0 | 3 | 7;
export type DunningRetryStatus = 'pending' | 'attempted' | 'skipped' | 'failed';

export interface IDunningRetryScheduleItem {
  day: DunningRetryDay;
  scheduledAt: Date;
  attemptedAt?: Date;
  status: DunningRetryStatus;
}

export interface IDunningState {
  userId: Types.ObjectId;
  userMembershipId: Types.ObjectId;
  paymentRecordId?: Types.ObjectId;
  status: DunningStatus;
  failedAt: Date;
  graceEndsAt?: Date;
  nextActionAt?: Date;
  retrySchedule: IDunningRetryScheduleItem[];
  lastFailureReason?: string;
  recoveredAt?: Date;
  suspendedAt?: Date;
  cancelledAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const dunningRetryScheduleSchema = new Schema<IDunningRetryScheduleItem>(
  {
    day: { type: Number, enum: [0, 3, 7], required: true },
    scheduledAt: { type: Date, required: true },
    attemptedAt: Date,
    status: { type: String, enum: ['pending', 'attempted', 'skipped', 'failed'], default: 'pending', required: true },
  },
  { _id: false }
);

const dunningStateSchema = new Schema<IDunningState>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    userMembershipId: { type: Schema.Types.ObjectId, ref: 'UserMembership', required: true },
    paymentRecordId: { type: Schema.Types.ObjectId, ref: 'PaymentRecord' },
    status: {
      type: String,
      enum: ['none', 'active', 'recovered', 'suspended', 'cancelled'],
      default: 'active',
      required: true,
      index: true,
    },
    failedAt: { type: Date, required: true },
    graceEndsAt: Date,
    nextActionAt: { type: Date, index: true },
    retrySchedule: { type: [dunningRetryScheduleSchema], default: [] },
    lastFailureReason: { type: String, trim: true },
    recoveredAt: Date,
    suspendedAt: Date,
    cancelledAt: Date,
  },
  { timestamps: true }
);

dunningStateSchema.index(
  { userMembershipId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
  }
);
dunningStateSchema.index({ status: 1, nextActionAt: 1 });

export const DunningState = model<IDunningState>('DunningState', dunningStateSchema);
