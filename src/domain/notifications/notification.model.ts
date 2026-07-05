import { Schema, model, Types } from 'mongoose';

export type NotificationType =
  | 'auction_won'
  | 'auction_lost'
  | 'auction_closed'
  | 'sale_confirmed'
  | 'sale_cancelled'
  | 'membership_payment_failed'
  | 'membership_grace_period_started'
  | 'membership_dunning_started'
  | 'membership_dunning_retry'
  | 'membership_recovered'
  | 'membership_suspended'
  | 'membership_cancelled'
  | 'membership_upgrade_requested'
  | 'membership_downgrade_scheduled'
  | 'membership_downgrade_completed'
  | 'membership_cancellation_scheduled'
  | 'membership_cancellation_completed'
  | 'membership_reactivation'
  | 'membership_created'
  | 'membership_activated'
  | 'membership_expiring'
  | 'membership_expired'
  | 'membership_suspended'
  | 'membership_activated_from_payment'
  | 'payment_confirmed'
  | 'payment_failed'
  | 'invoice_issued'
  | 'invoice_failed'
  | 'invoice_cancelled'
  | 'invoice_pending';

export interface INotification {
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  read: boolean;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: [
        'auction_won',
        'auction_lost',
        'auction_closed',
        'sale_confirmed',
        'sale_cancelled',
        'membership_payment_failed',
        'membership_grace_period_started',
        'membership_dunning_started',
        'membership_dunning_retry',
        'membership_recovered',
        'membership_suspended',
        'membership_cancelled',
        'membership_upgrade_requested',
        'membership_downgrade_scheduled',
        'membership_downgrade_completed',
        'membership_cancellation_scheduled',
        'membership_cancellation_completed',
        'membership_reactivation',
        'membership_created',
        'membership_activated',
        'membership_expiring',
        'membership_expired',
        'membership_suspended',
        'membership_activated_from_payment',
        'payment_confirmed',
        'payment_failed',
        'invoice_issued',
        'invoice_failed',
        'invoice_cancelled',
        'invoice_pending',
      ],
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    read: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

NotificationSchema.index({ userId: 1, createdAt: -1 });

export const Notification = model<INotification>('Notification', NotificationSchema);




