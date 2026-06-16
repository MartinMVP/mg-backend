import { Schema, model, Types } from 'mongoose';

export const messageTypes = ['text', 'system'] as const;
export type MessageType = typeof messageTypes[number];

export const messageSources = ['membership', 'payment', 'auction', 'refund', 'system'] as const;
export type MessageSource = typeof messageSources[number];

export const messageStatuses = ['active', 'deleted'] as const;
export type MessageStatus = typeof messageStatuses[number];

export interface IMessage {
  conversationId: Types.ObjectId;
  senderId?: Types.ObjectId;
  type: MessageType;
  source?: MessageSource;
  metadata?: Record<string, unknown>;
  eventKey?: string;
  status: MessageStatus;
  body: string;
  createdAt: Date;
  updatedAt: Date;
}

const messageSchema = new Schema<IMessage>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    type: { type: String, enum: messageTypes, required: true, index: true },
    source: { type: String, enum: messageSources },
    metadata: { type: Schema.Types.Mixed },
    eventKey: { type: String, trim: true },
    status: { type: String, enum: messageStatuses, default: 'active', index: true },
    body: { type: String, required: true, trim: true, maxlength: 4000 },
  },
  { timestamps: true }
);

messageSchema.pre('validate', function () {
  if (this.type === 'text' && !this.senderId) {
    this.invalidate('senderId', 'senderId_required_for_text_message');
  }
  if (this.type === 'text' && this.eventKey) {
    this.invalidate('eventKey', 'eventKey_allowed_only_for_system_messages');
  }
});

messageSchema.index({ conversationId: 1, createdAt: 1 });
messageSchema.index(
  { conversationId: 1, eventKey: 1 },
  {
    unique: true,
    partialFilterExpression: { type: 'system', eventKey: { $type: 'string' } },
  }
);

export const Message = model<IMessage>('Message', messageSchema);
