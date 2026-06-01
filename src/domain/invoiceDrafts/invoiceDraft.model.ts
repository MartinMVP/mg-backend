import { Schema, model, Types } from 'mongoose';

export type InvoiceDraftStatus =
  | 'draft'
  | 'ready'
  | 'blocked'
  | 'cancelled';

export interface IInvoiceDraft {
  transactionId: Types.ObjectId;
  fiscalSnapshotId: Types.ObjectId;
  auctionResultId: Types.ObjectId;
  buyerId: Types.ObjectId;
  sellerId: Types.ObjectId;
  amount: number;
  currency: 'MXN';
  status: InvoiceDraftStatus;
  blockingReason?: string;
  createdFromTransaction: boolean;
}

const InvoiceDraftSchema = new Schema<IInvoiceDraft>(
  {
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      required: true,
      unique: true,
      index: true,
    },
    fiscalSnapshotId: {
      type: Schema.Types.ObjectId,
      ref: 'FiscalSnapshot',
      required: true,
      index: true,
    },
    auctionResultId: { type: Schema.Types.ObjectId, ref: 'AuctionResult', required: true, index: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'MXN' },
    status: {
      type: String,
      enum: ['draft', 'ready', 'blocked', 'cancelled'],
      default: 'draft',
      index: true,
    },
    blockingReason: { type: String, trim: true },
    createdFromTransaction: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const InvoiceDraft = model<IInvoiceDraft>('InvoiceDraft', InvoiceDraftSchema);
