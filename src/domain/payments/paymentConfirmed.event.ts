import { Types } from 'mongoose';

export type PaymentConfirmed = {
  userId: Types.ObjectId;
  planId: Types.ObjectId;
  membershipId: Types.ObjectId;
  paymentTransactionId: Types.ObjectId;
  amount: number;
  currency: 'MXN';
  confirmedAt: Date;
};
