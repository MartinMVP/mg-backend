import { Schema, model, Types } from 'mongoose';

export type NotificationType =
  | 'auction_won'
  | 'auction_lost'
  | 'auction_closed'
  | 'sale_confirmed'
  | 'sale_cancelled';

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
      enum: ['auction_won', 'auction_lost', 'auction_closed', 'sale_confirmed', 'sale_cancelled'],
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
