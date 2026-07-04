import { Schema, model, Types } from 'mongoose';

export const auctionAppealStatuses = ['requested', 'under_review', 'approved', 'rejected', 'closed'] as const;
export type AuctionAppealStatus = typeof auctionAppealStatuses[number];

export interface IAuctionAppeal {
  sanctionId: Types.ObjectId;
  userId: Types.ObjectId;
  reason: string;
  evidence?: unknown;
  status: AuctionAppealStatus;
  reviewedBy?: Types.ObjectId;
  resolution?: string;
  resolvedAt?: Date;
  createdAt: Date;
}

const auctionAppealSchema = new Schema<IAuctionAppeal>(
  {
    sanctionId: { type: Schema.Types.ObjectId, ref: 'AuctionSanction', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reason: { type: String, required: true, trim: true, minlength: 10, maxlength: 2000 },
    evidence: { type: Schema.Types.Mixed },
    status: { type: String, enum: auctionAppealStatuses, default: 'requested', index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolution: { type: String, trim: true, maxlength: 2000 },
    resolvedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auctionAppealSchema.index({ sanctionId: 1, status: 1 });
auctionAppealSchema.index(
  { sanctionId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['requested', 'under_review'] } },
  }
);
auctionAppealSchema.index({ createdAt: -1 });

export const AuctionAppeal = model<IAuctionAppeal>('AuctionAppeal', auctionAppealSchema);
