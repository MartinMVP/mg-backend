import { Schema, model, Types } from 'mongoose';

export const auctionSanctionTypes = ['buyer', 'seller'] as const;
export type AuctionSanctionType = typeof auctionSanctionTypes[number];

export const auctionSanctionStatuses = ['active', 'expired', 'revoked'] as const;
export type AuctionSanctionStatus = typeof auctionSanctionStatuses[number];

export interface IAuctionSanction {
  userId: Types.ObjectId;
  type: AuctionSanctionType;
  sourceDefaultId: Types.ObjectId;
  offenseNumber: number;
  reason: string;
  status: AuctionSanctionStatus;
  startsAt: Date;
  endsAt?: Date;
  createdBy: Types.ObjectId;
  revokedBy?: Types.ObjectId;
  revokedAt?: Date;
  createdAt: Date;
}

const auctionSanctionSchema = new Schema<IAuctionSanction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: auctionSanctionTypes, required: true, index: true },
    sourceDefaultId: { type: Schema.Types.ObjectId, ref: 'AuctionDefaultReport', required: true },
    offenseNumber: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, trim: true, maxlength: 1000 },
    status: { type: String, enum: auctionSanctionStatuses, default: 'active', index: true },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    revokedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    revokedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auctionSanctionSchema.index({ userId: 1, type: 1, status: 1 });
auctionSanctionSchema.index(
  { sourceDefaultId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['active', 'expired'] } } }
);
auctionSanctionSchema.index({ createdAt: -1 });

export const AuctionSanction = model<IAuctionSanction>('AuctionSanction', auctionSanctionSchema);
