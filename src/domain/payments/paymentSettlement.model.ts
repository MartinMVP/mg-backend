import { Schema, model, Types } from 'mongoose';

export interface IPaymentSettlement {
  operationId: Types.ObjectId;
  operationNumber: string;
  operationType: string;
  referenceType: string;
  referenceId: string;
  amount: number;
  currency: string;
  paymentTransactionId: Types.ObjectId;
  providerEventId: string;
  settledAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSettlementSchema = new Schema<IPaymentSettlement>(
  {
    operationId: { type: Schema.Types.ObjectId, ref: 'CommercialOperation', required: true, unique: true, index: true },
    operationNumber: { type: String, required: true, index: true, trim: true },
    operationType: { type: String, required: true, index: true, trim: true },
    referenceType: { type: String, required: true, trim: true },
    referenceId: { type: String, required: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true },
    paymentTransactionId: { type: Schema.Types.ObjectId, ref: 'PaymentTransaction', required: true, index: true },
    providerEventId: { type: String, required: true, unique: true, trim: true },
    settledAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export const PaymentSettlement = model<IPaymentSettlement>('PaymentSettlement', paymentSettlementSchema);
