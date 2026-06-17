import { Schema, model, Types } from 'mongoose';

export const auctionCloseOutcomes = ['completed', 'not_completed', 'seller_unresponsive'] as const;
export type AuctionCloseOutcomeType = typeof auctionCloseOutcomes[number];

export interface IAuctionCloseOutcome {
  auctionListingId: Types.ObjectId;
  listingId: Types.ObjectId;
  sellerId: Types.ObjectId;
  winnerUserId: Types.ObjectId;
  outcome: AuctionCloseOutcomeType;
  recordedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

function rejectImmutableUpdate() {
  throw new Error('auction_close_outcome_immutable');
}

const auctionCloseOutcomeSchema = new Schema<IAuctionCloseOutcome>(
  {
    auctionListingId: {
      type: Schema.Types.ObjectId,
      ref: 'AuctionListing',
      required: true,
      unique: true,
      index: true,
      immutable: true,
    },
    listingId: { type: Schema.Types.ObjectId, ref: 'Listing', required: true, index: true, immutable: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true, immutable: true },
    winnerUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true, immutable: true },
    outcome: { type: String, enum: auctionCloseOutcomes, required: true, index: true, immutable: true },
    recordedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true, immutable: true },
  },
  { timestamps: true }
);

auctionCloseOutcomeSchema.index({ outcome: 1, createdAt: -1 });
auctionCloseOutcomeSchema.index({ createdAt: -1 });

auctionCloseOutcomeSchema.pre('save', function () {
  if (!this.isNew) rejectImmutableUpdate();
});

auctionCloseOutcomeSchema.pre('findOneAndUpdate', rejectImmutableUpdate);
auctionCloseOutcomeSchema.pre('updateOne', rejectImmutableUpdate);
auctionCloseOutcomeSchema.pre('updateMany', rejectImmutableUpdate);
auctionCloseOutcomeSchema.pre('replaceOne', rejectImmutableUpdate);

export const AuctionCloseOutcome = model<IAuctionCloseOutcome>(
  'AuctionCloseOutcome',
  auctionCloseOutcomeSchema
);
