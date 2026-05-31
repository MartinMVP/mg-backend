import { Schema, model, Types } from 'mongoose';

export type AuctionResultStatus =
  | 'pending_contact'
  | 'contacted'
  | 'sale_confirmed'
  | 'sale_cancelled'
  | 'in_dispute';

export interface IAuctionResult {
  auctionId: Types.ObjectId;
  listingId: Types.ObjectId;
  sellerId: Types.ObjectId;
  buyerId: Types.ObjectId;
  finalPrice: number;
  closedAt: Date;
  status: AuctionResultStatus;
  notes?: string;
}

const AuctionResultSchema = new Schema<IAuctionResult>(
  {
    auctionId: { type: Schema.Types.ObjectId, ref: 'Auction', required: true, unique: true, index: true },
    listingId: { type: Schema.Types.ObjectId, ref: 'Listing', required: true, index: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    finalPrice: { type: Number, required: true, min: 0 },
    closedAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ['pending_contact', 'contacted', 'sale_confirmed', 'sale_cancelled', 'in_dispute'],
      default: 'pending_contact',
      index: true,
    },
    notes: { type: String, trim: true },
  },
  { timestamps: true }
);

export const AuctionResult = model<IAuctionResult>('AuctionResult', AuctionResultSchema);
