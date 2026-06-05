import { Schema, model, Types } from 'mongoose';
import { PaymentProvider } from './paymentCustomer.model';
import { StripeEnvironment } from './stripe.config';

export type PaymentRecordType = 'membership';
export type PaymentRecordStatus = 'pending' | 'succeeded' | 'failed' | 'refunded' | 'disputed' | 'cancelled';

export interface IPaymentRecord {
  userId: Types.ObjectId;
  membershipPlanId?: Types.ObjectId;
  userMembershipId?: Types.ObjectId;
  provider: PaymentProvider;
  providerEnvironment: StripeEnvironment;
  providerPaymentId?: string;
  providerInvoiceId?: string;
  providerSubscriptionId?: string;
  providerCustomerId?: string;
  type: PaymentRecordType;
  status: PaymentRecordStatus;
  amount: number;
  currency: 'MXN';
  metadata?: Record<string, unknown>;
  paidAt?: Date;
  failedAt?: Date;
  failureReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const paymentRecordSchema = new Schema<IPaymentRecord>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    membershipPlanId: { type: Schema.Types.ObjectId, ref: 'MembershipPlan' },
    userMembershipId: { type: Schema.Types.ObjectId, ref: 'UserMembership' },
    provider: { type: String, enum: ['stripe'], default: 'stripe', required: true },
    providerEnvironment: { type: String, enum: ['sandbox', 'production'], required: true },
    providerPaymentId: { type: String, trim: true, index: true },
    providerInvoiceId: { type: String, trim: true, index: true },
    providerSubscriptionId: { type: String, trim: true, index: true },
    providerCustomerId: { type: String, trim: true },
    type: { type: String, enum: ['membership'], default: 'membership', required: true },
    status: {
      type: String,
      enum: ['pending', 'succeeded', 'failed', 'refunded', 'disputed', 'cancelled'],
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['MXN'], default: 'MXN', required: true },
    metadata: { type: Schema.Types.Mixed },
    paidAt: Date,
    failedAt: Date,
    failureReason: { type: String, trim: true },
  },
  { timestamps: true }
);

paymentRecordSchema.index({ userId: 1, status: 1 });

export const PaymentRecord = model<IPaymentRecord>('PaymentRecord', paymentRecordSchema);
