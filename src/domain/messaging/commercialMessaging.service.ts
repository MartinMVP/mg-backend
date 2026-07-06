import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { Listing } from '../listings/listing.model';
import { getUserMembership } from '../memberships/membership.service';
import { operationallyActiveMembershipStatuses } from '../memberships/userMembership.model';
import { Notification } from '../notifications/notification.model';
import { Conversation } from './conversation.model';
import { ConversationParticipant } from './conversationParticipant.model';
import { Message } from './message.model';

export const commercialMessagingAuditActions = {
  conversationCreated: 'CONVERSATION_CREATED',
  messageSent: 'MESSAGE_SENT',
  conversationArchived: 'CONVERSATION_ARCHIVED',
  conversationClosed: 'CONVERSATION_CLOSED',
} as const;

const defaultPage = 1;
const defaultLimit = 20;
const maxLimit = 100;

function toObjectId(id: string | Types.ObjectId) {
  if (!Types.ObjectId.isValid(String(id))) throw new Error('invalid_object_id');
  return typeof id === 'string' ? new Types.ObjectId(id) : id;
}

function normalizePagination(input: { page?: unknown; limit?: unknown } = {}) {
  const parsedPage = Number(input.page);
  const parsedLimit = Number(input.limit);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : defaultPage;
  const limit = Number.isFinite(parsedLimit) && parsedLimit >= 1 ? Math.min(Math.floor(parsedLimit), maxLimit) : defaultLimit;
  return { page, limit, skip: (page - 1) * limit };
}

async function audit(actor: string, action: string, conversationId: Types.ObjectId) {
  await Audit.create({ actor, action, conversationId });
}

async function notify(userId: Types.ObjectId, type: any, title: string, message: string) {
  await Notification.create({ userId, type, title, message, read: false });
}

async function assertCommercialParticipant(conversationId: Types.ObjectId, userId: Types.ObjectId) {
  const participant = await ConversationParticipant.findOne({ conversationId, userId, status: 'active' });
  if (!participant) {
    const error = new Error('forbidden');
    (error as any).status = 403;
    throw error;
  }
  const conversation = await Conversation.findOne({ _id: conversationId, type: 'listing' });
  if (!conversation) {
    const error = new Error('conversation_not_found');
    (error as any).status = 404;
    throw error;
  }
  return { conversation, participant };
}

async function validateMembershipForConversation(userId: Types.ObjectId) {
  const { membership } = await getUserMembership(userId);
  if (!membership || !operationallyActiveMembershipStatuses.includes(membership.status)) {
    const error = new Error('membership_required');
    (error as any).status = 409;
    throw error;
  }
}

async function addParticipant(conversationId: Types.ObjectId, userId: Types.ObjectId) {
  return ConversationParticipant.findOneAndUpdate(
    { conversationId, userId },
    {
      $setOnInsert: { conversationId, userId, joinedAt: new Date(), unreadCount: 0 },
      $set: { status: 'active' },
    },
    { upsert: true, new: true, runValidators: true }
  );
}

export async function createListingConversation(input: { listingId?: string; buyerId: string }) {
  if (!input.listingId) throw new Error('listingId_required');
  const listingId = toObjectId(input.listingId);
  const buyerId = toObjectId(input.buyerId);
  const listing = await Listing.findOne({ _id: listingId, status: 'published' });
  if (!listing) throw new Error('listing_not_found');

  const sellerId = toObjectId(listing.seller);
  if (String(sellerId) === String(buyerId)) throw new Error('cannot_message_self');
  await validateMembershipForConversation(buyerId);

  const existing = await Conversation.findOne({
    type: 'listing',
    listingId,
    sellerId,
    buyerId,
    status: 'active',
  }).sort({ createdAt: -1 });
  if (existing) return { conversation: existing, created: false };

  const conversation = await Conversation.create({
    type: 'listing',
    status: 'active',
    listingId,
    sellerId,
    buyerId,
    createdBy: buyerId,
    messageCount: 0,
  });
  await Promise.all([addParticipant(conversation._id, sellerId), addParticipant(conversation._id, buyerId)]);
  await audit(String(buyerId), commercialMessagingAuditActions.conversationCreated, conversation._id);
  await notify(sellerId, 'conversation_created', 'Nuevo contacto comercial', 'Un comprador inició una conversación desde tu publicación.');
  return { conversation, created: true };
}

export async function listListingConversationsForUser(userId: string, paginationInput: { page?: unknown; limit?: unknown } = {}) {
  const userObjectId = toObjectId(userId);
  const pagination = normalizePagination(paginationInput);
  const participantRows = await ConversationParticipant.find({ userId: userObjectId, status: 'active' }).select('conversationId unreadCount').lean();
  const unreadByConversation = new Map(participantRows.map((row) => [String(row.conversationId), row.unreadCount || 0]));
  const query = { _id: { $in: participantRows.map((row) => row.conversationId) }, type: 'listing', status: { $in: ['active', 'archived', 'closed'] } };

  const [total, conversations] = await Promise.all([
    Conversation.countDocuments(query),
    Conversation.find(query)
      .sort({ lastMessageAt: -1, updatedAt: -1, createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
  ]);
  return {
    page: pagination.page,
    limit: pagination.limit,
    total,
    conversations: conversations.map((conversation) => ({
      ...conversation,
      conversationType: 'listing',
      unreadCount: unreadByConversation.get(String(conversation._id)) || 0,
    })),
  };
}

export async function getListingConversationForUser(conversationId: string, userId: string, paginationInput: { page?: unknown; limit?: unknown } = {}) {
  const conversationObjectId = toObjectId(conversationId);
  const userObjectId = toObjectId(userId);
  const { conversation, participant } = await assertCommercialParticipant(conversationObjectId, userObjectId);
  const pagination = normalizePagination(paginationInput);
  const [participants, total, messages] = await Promise.all([
    ConversationParticipant.find({ conversationId: conversationObjectId }).lean(),
    Message.countDocuments({ conversationId: conversationObjectId, status: { $ne: 'deleted' } }),
    Message.find({ conversationId: conversationObjectId, status: { $ne: 'deleted' } })
      .sort({ createdAt: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
  ]);
  return {
    conversation: { ...conversation.toObject(), conversationType: 'listing', unreadCount: participant.unreadCount || 0, participants },
    messages: { page: pagination.page, limit: pagination.limit, total, items: messages },
  };
}

export async function sendListingConversationMessage(input: { conversationId: string; senderId: string; body: string; metadata?: Record<string, unknown> }) {
  const conversationObjectId = toObjectId(input.conversationId);
  const senderId = toObjectId(input.senderId);
  const { conversation } = await assertCommercialParticipant(conversationObjectId, senderId);
  if (conversation.status !== 'active') {
    const error = new Error('conversation_not_active');
    (error as any).status = 409;
    throw error;
  }

  const body = String(input.body || '').trim();
  if (!body) throw new Error('message_body_required');

  const message = await Message.create({ conversationId: conversationObjectId, senderId, type: 'text', status: 'active', body, metadata: input.metadata });
  const now = message.createdAt;
  await Conversation.findByIdAndUpdate(conversationObjectId, {
    $set: {
      firstMessageAt: conversation.firstMessageAt || now,
      lastMessageAt: now,
      lastMessageId: message._id,
      lastMessagePreview: body.length > 160 ? `${body.slice(0, 157)}...` : body,
      updatedAt: new Date(),
    },
    $inc: { messageCount: 1 },
  });
  await ConversationParticipant.updateMany({ conversationId: conversationObjectId, userId: { $ne: senderId }, status: 'active' }, { $inc: { unreadCount: 1 } });
  await audit(String(senderId), commercialMessagingAuditActions.messageSent, conversationObjectId);

  const recipientId = String(conversation.sellerId) === String(senderId) ? conversation.buyerId : conversation.sellerId;
  if (recipientId) await notify(recipientId, 'message_received', 'Nuevo mensaje comercial', 'Recibiste un mensaje sobre una publicación.');
  return message;
}

export async function archiveListingConversation(input: { conversationId: string; actorId: string }) {
  const conversationObjectId = toObjectId(input.conversationId);
  await assertCommercialParticipant(conversationObjectId, toObjectId(input.actorId));
  const updated = await Conversation.findByIdAndUpdate(
    conversationObjectId,
    { $set: { status: 'archived', archivedAt: new Date() } },
    { new: true, runValidators: true }
  );
  if (!updated) throw new Error('conversation_not_found');
  await audit(input.actorId, commercialMessagingAuditActions.conversationArchived, conversationObjectId);
  return updated;
}

export async function closeListingConversation(input: { conversationId: string; actorId: string }) {
  const conversationObjectId = toObjectId(input.conversationId);
  await assertCommercialParticipant(conversationObjectId, toObjectId(input.actorId));
  const updated = await Conversation.findByIdAndUpdate(
    conversationObjectId,
    { $set: { status: 'closed', closedAt: new Date() } },
    { new: true, runValidators: true }
  );
  if (!updated) throw new Error('conversation_not_found');
  await audit(input.actorId, commercialMessagingAuditActions.conversationClosed, conversationObjectId);
  return updated;
}
