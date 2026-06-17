import { Schema, model, Types } from 'mongoose';

export const auctionListingStatuses = ['draft', 'active', 'closed', 'cancelled'] as const;
export type AuctionListingStatus = typeof auctionListingStatuses[number];

export const auctionListingClosedReasons = ['ended', 'admin_closed', 'cancelled'] as const;
export type AuctionListingClosedReason = typeof auctionListingClosedReasons[number];

export interface IAuctionListing {
  listingId: Types.ObjectId;
  sellerId: Types.ObjectId;
  status: AuctionListingStatus;
  startingPrice: number;
  currentPrice: number;
  winnerUserId?: Types.ObjectId;
  winningBidId?: Types.ObjectId;
  startsAt: Date;
  endsAt: Date;
  extensionCount: number;
  closedAt?: Date;
  closedReason?: AuctionListingClosedReason;
  createdAt: Date;
  updatedAt: Date;
}

const auctionListingSchema = new Schema<IAuctionListing>(
  {
    listingId: { type: Schema.Types.ObjectId, ref: 'Listing', required: true, index: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: auctionListingStatuses, default: 'draft', index: true },
    startingPrice: { type: Number, required: true, min: 1 },
    currentPrice: { type: Number, required: true, min: 1 },
    winnerUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    winningBidId: { type: Schema.Types.ObjectId, ref: 'AuctionBid' },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true, index: true },
    extensionCount: { type: Number, default: 0, min: 0 },
    closedAt: { type: Date },
    closedReason: { type: String, enum: auctionListingClosedReasons },
  },
  { timestamps: true }
);

auctionListingSchema.index({ status: 1, endsAt: 1 });
auctionListingSchema.index({ sellerId: 1, status: 1, createdAt: -1 });
auctionListingSchema.index({ createdAt: -1 });

export const AuctionListing = model<IAuctionListing>('AuctionListing', auctionListingSchema);
