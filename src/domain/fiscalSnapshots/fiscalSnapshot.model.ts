import { Schema, model, Types } from 'mongoose';

export interface IFiscalSnapshot {
  transactionId: Types.ObjectId;
  auctionResultId: Types.ObjectId;
  buyerId: Types.ObjectId;
  sellerId: Types.ObjectId;
  buyerFiscalProfile?: unknown;
  sellerFiscalProfile?: unknown;
  amount: number;
  currency: 'MXN';
}

const FiscalSnapshotSchema = new Schema<IFiscalSnapshot>(
  {
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      required: true,
      unique: true,
      index: true,
    },
    auctionResultId: { type: Schema.Types.ObjectId, ref: 'AuctionResult', required: true, index: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    buyerFiscalProfile: { type: Schema.Types.Mixed, default: null },
    sellerFiscalProfile: { type: Schema.Types.Mixed, default: null },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'MXN' },
  },
  { timestamps: true }
);

export const FiscalSnapshot = model<IFiscalSnapshot>('FiscalSnapshot', FiscalSnapshotSchema);
