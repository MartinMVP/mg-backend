import { Schema, model, Types } from 'mongoose';

export type TransactionStatus =
  | 'pending'
  | 'ready_for_invoice'
  | 'invoiced'
  | 'cancelled';

export interface ITransaction {
  auctionResultId: Types.ObjectId;
  buyerId: Types.ObjectId;
  sellerId: Types.ObjectId;
  amount: number;
  status: TransactionStatus;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    auctionResultId: {
      type: Schema.Types.ObjectId,
      ref: 'AuctionResult',
      required: true,
      unique: true,
      index: true,
    },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['pending', 'ready_for_invoice', 'invoiced', 'cancelled'],
      default: 'pending',
      index: true,
    },
  },
  { timestamps: true }
);

export const Transaction = model<ITransaction>('Transaction', TransactionSchema);
