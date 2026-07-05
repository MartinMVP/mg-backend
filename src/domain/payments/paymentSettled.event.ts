import { Types } from 'mongoose';

export type PaymentSettled = {
  transactionId: Types.ObjectId;
  userId: Types.ObjectId;
  membershipId: Types.ObjectId;
  amount: number;
  currency: 'MXN';
  paidAt: Date;
};
