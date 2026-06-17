import { Schema, model, Types } from 'mongoose';

export const auctionBidStatuses = ['valid', 'rejected'] as const;
export type AuctionBidStatus = typeof auctionBidStatuses[number];

export interface IAuctionBid {
  auctionListingId: Types.ObjectId;
  bidderId: Types.ObjectId;
  amount: number;
  status: AuctionBidStatus;
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const auctionBidSchema = new Schema<IAuctionBid>(
  {
    auctionListingId: { type: Schema.Types.ObjectId, ref: 'AuctionListing', required: true, index: true },
    bidderId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: auctionBidStatuses, default: 'valid', index: true },
    rejectionReason: { type: String, trim: true, maxlength: 200 },
  },
  { timestamps: true }
);

auctionBidSchema.index({ auctionListingId: 1, status: 1, amount: -1, createdAt: -1 });
auctionBidSchema.index({ auctionListingId: 1, createdAt: -1 });

export const AuctionBid = model<IAuctionBid>('AuctionBid', auctionBidSchema);
