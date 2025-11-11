import { Schema, model, Types } from 'mongoose';

export type AuctionState = 'scheduled' | 'live' | 'paused' | 'closed';

export interface IAuction {
  title: string;
  state: AuctionState;
  startsAt: Date;
  endsAt: Date;
  listing: Types.ObjectId;          // MVP: 1 listing por subasta
  startPrice: number;               // precio base
  minIncrement: number;             // incremento mínimo
  currentPrice: number;             // precio vigente
  currentWinner?: Types.ObjectId;   // user id
  antiSnipingSec: number;           // umbral para extender
  antiSnipingExtendSec: number;     // extensión
  antiSnipingMaxExt: number;        // máx extensiones
  antiSnipingCount: number;         // extensiones aplicadas
}

const AuctionSchema = new Schema<IAuction>(
  {
    title: { type: String, required: true, trim: true },
    state: {
      type: String,
      enum: ['scheduled', 'live', 'paused', 'closed'],
      index: true,
      default: 'scheduled',
    },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    listing: { type: Schema.Types.ObjectId, ref: 'Listing', required: true, index: true },
    startPrice: { type: Number, required: true, min: 0 },
    minIncrement: { type: Number, required: true, min: 1 },
    currentPrice: { type: Number, required: true, min: 0 },
    currentWinner: { type: Schema.Types.ObjectId, ref: 'User' },
    antiSnipingSec: { type: Number, default: 30 },
    antiSnipingExtendSec: { type: Number, default: 20 },
    antiSnipingMaxExt: { type: Number, default: 3 },
    antiSnipingCount: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: 'v' }
);

AuctionSchema.index({ state: 1, endsAt: 1 });

export const Auction = model<IAuction>('Auction', AuctionSchema);
