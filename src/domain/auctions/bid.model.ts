import { Schema, model, Types } from 'mongoose';

export interface IBid {
  auction: Types.ObjectId;
  listing: Types.ObjectId;
  bidder: Types.ObjectId;
  amount: number;
}

const BidSchema = new Schema<IBid>(
  {
    auction: { type: Schema.Types.ObjectId, ref: 'Auction', index: true },
    listing: { type: Schema.Types.ObjectId, ref: 'Listing', index: true },
    bidder: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    amount: { type: Number, required: true, min: 0 },
  },
  { timestamps: true }
);

export const Bid = model<IBid>('Bid', BidSchema);
