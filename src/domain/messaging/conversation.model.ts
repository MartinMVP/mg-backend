import { Schema, model, Types } from 'mongoose';

export const conversationTypes = ['listing', 'commercial', 'auction', 'support', 'system', 'admin'] as const;
export type ConversationType = typeof conversationTypes[number];

export const conversationStatuses = ['active', 'archived', 'closed', 'deleted'] as const;
export type ConversationStatus = typeof conversationStatuses[number];

export interface IConversation {
  type: ConversationType;
  status: ConversationStatus;
  listingId?: Types.ObjectId;
  sellerId?: Types.ObjectId;
  buyerId?: Types.ObjectId;
  auctionListingId?: Types.ObjectId;
  createdBy: Types.ObjectId;
  firstMessageAt?: Date;
  lastMessageAt?: Date;
  lastMessageId?: Types.ObjectId;
  messageCount: number;
  archivedAt?: Date;
  closedAt?: Date;
  lastMessagePreview?: string;
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = new Schema<IConversation>(
  {
    type: { type: String, enum: conversationTypes, required: true, index: true },
    status: { type: String, enum: conversationStatuses, default: 'active', index: true },
    listingId: { type: Schema.Types.ObjectId, ref: 'Listing', index: true },
    sellerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    buyerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    auctionListingId: { type: Schema.Types.ObjectId, ref: 'AuctionListing', index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    firstMessageAt: { type: Date },
    lastMessageAt: { type: Date, index: true },
    lastMessageId: { type: Schema.Types.ObjectId, ref: 'Message' },
    messageCount: { type: Number, default: 0, min: 0 },
    lastMessagePreview: { type: String, trim: true, maxlength: 160 },
    archivedAt: { type: Date },
    closedAt: { type: Date },
  },
  { timestamps: true }
);

conversationSchema.index({ type: 1, listingId: 1, createdBy: 1, status: 1 });
conversationSchema.index({ type: 1, listingId: 1, sellerId: 1, buyerId: 1, status: 1 });
conversationSchema.index({ updatedAt: -1 });
conversationSchema.index({ lastMessageAt: -1, updatedAt: -1, createdAt: -1 });

export const Conversation = model<IConversation>('Conversation', conversationSchema);

