import { Schema, model, Types } from 'mongoose';

export const conversationTypes = ['commercial', 'auction', 'support', 'system', 'admin'] as const;
export type ConversationType = typeof conversationTypes[number];

export const conversationStatuses = ['active', 'archived', 'closed', 'deleted'] as const;
export type ConversationStatus = typeof conversationStatuses[number];

export interface IConversation {
  type: ConversationType;
  status: ConversationStatus;
  listingId?: Types.ObjectId;
  auctionListingId?: Types.ObjectId;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<IConversation>(
  {
    type: { type: String, enum: conversationTypes, required: true, index: true },
    status: { type: String, enum: conversationStatuses, default: 'active', index: true },
    listingId: { type: Schema.Types.ObjectId, ref: 'Listing', index: true },
    auctionListingId: { type: Schema.Types.ObjectId, ref: 'Auction', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true }
);

conversationSchema.index({ type: 1, listingId: 1, createdBy: 1, status: 1 });
conversationSchema.index({ updatedAt: -1 });

export const Conversation = model<IConversation>('Conversation', conversationSchema);
