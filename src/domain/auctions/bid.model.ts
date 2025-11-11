import { Schema, model, Types } from 'mongoose';

export interface IBid {
  auction: Types.ObjectId;
  listing: Types.ObjectId;
  bidder: Types.ObjectId;
  amount: number;
}

const BidSchema = new Schema<IBid>(
  {
    auction: { type: Schema.Types.ObjectId, ref: 'Auction', index: true, required: true },
    listing: { type: Schema.Types.ObjectId, ref: 'Listing', index: true, required: true },
    bidder: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

BidSchema.index({ auction: 1, createdAt: -1 });

export const Bid = model<IBid>('Bid', BidSchema);
