import { Schema, model, Types } from 'mongoose';

export type AuctionState = 'scheduled' | 'live' | 'paused' | 'closed';

export interface IAuction {
  title: string;
  state: AuctionState;
  startsAt: Date;
  endsAt: Date;
  lots: Types.ObjectId[];      // ref -> Listing
  createdBy?: Types.ObjectId;  // ref -> User (admin)
  active: boolean;
}

const AuctionSchema = new Schema<IAuction>(
  {
    title: { type: String, required: true, trim: true },
    state: { type: String, enum: ['scheduled', 'live', 'paused', 'closed'], index: true, default: 'scheduled' },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    lots: [{ type: Schema.Types.ObjectId, ref: 'Listing' }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Auction = model<IAuction>('Auction', AuctionSchema);
