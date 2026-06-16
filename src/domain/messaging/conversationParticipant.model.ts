import { Schema, model, Types } from 'mongoose';

export const conversationParticipantStatuses = ['active', 'archived', 'blocked', 'removed'] as const;
export type ConversationParticipantStatus = typeof conversationParticipantStatuses[number];

export interface IConversationParticipant {
  conversationId: Types.ObjectId;
  userId: Types.ObjectId;
  status: ConversationParticipantStatus;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const conversationParticipantSchema = new Schema<IConversationParticipant>(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: conversationParticipantStatuses, default: 'active', index: true },
    joinedAt: { type: Date, default: Date.now, required: true },
  },
  { timestamps: true }
);

conversationParticipantSchema.index({ conversationId: 1, userId: 1 }, { unique: true });
conversationParticipantSchema.index({ userId: 1, status: 1, updatedAt: -1 });

export const ConversationParticipant = model<IConversationParticipant>(
  'ConversationParticipant',
  conversationParticipantSchema
);
