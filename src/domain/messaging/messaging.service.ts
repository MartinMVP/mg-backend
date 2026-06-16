import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { Listing } from '../listings/listing.model';
import { getUserMembership } from '../memberships/membership.service';
import { Conversation, ConversationType } from './conversation.model';
import { ConversationParticipant } from './conversationParticipant.model';
import { Message, MessageSource } from './message.model';

export const messagingAuditActions = {
  conversationCreated: 'CONVERSATION_CREATED',
  messageSent: 'MESSAGE_SENT',
  conversationArchived: 'CONVERSATION_ARCHIVED',
  conversationClosed: 'CONVERSATION_CLOSED',
  systemMessageCreated: 'SYSTEM_MESSAGE_CREATED',
} as const;

// TODO: migrar a Platform Configuration Center
export const conversationDailyLimitsByPlan = {
  free: 10,
  pro: 50,
  business: 1000,
} as const;

function toObjectId(id: string | Types.ObjectId) {
  if (!Types.ObjectId.isValid(String(id))) throw new Error('invalid_object_id');
  return typeof id === 'string' ? new Types.ObjectId(id) : id;
}

function dayStart(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function normalizePlanCode(planCode?: string | null): keyof typeof conversationDailyLimitsByPlan {
  const code = String(planCode || 'free').toLowerCase();
  if (code === 'business') return 'business';
  if (code === 'pro') return 'pro';
  return 'free';
}

async function audit(actor: string, action: string, conversationId: Types.ObjectId) {
  await Audit.create({ actor, action, conversationId });
}

async function enforceConversationLimit(userId: string | Types.ObjectId) {
  const { plan } = await getUserMembership(userId);
  const planCode = normalizePlanCode(plan?.code);
  const limit = conversationDailyLimitsByPlan[planCode];
  const count = await Conversation.countDocuments({
    createdBy: toObjectId(userId),
    createdAt: { $gte: dayStart() },
  });

  if (count >= limit) {
    const error = new Error('conversation_daily_limit_reached');
    (error as any).status = 429;
    (error as any).limit = limit;
    (error as any).plan = planCode;
    throw error;
  }
}

async function ensureParticipant(conversationId: Types.ObjectId, userId: Types.ObjectId) {
  return ConversationParticipant.findOne({
    conversationId,
    userId,
    status: { $ne: 'removed' },
  });
}

export async function isConversationParticipant(
  conversationId: string | Types.ObjectId,
  userId: string | Types.ObjectId
) {
  return Boolean(await ensureParticipant(toObjectId(conversationId), toObjectId(userId)));
}

export async function isActiveConversationParticipant(
  conversationId: string | Types.ObjectId,
  userId: string | Types.ObjectId
) {
  return Boolean(await ConversationParticipant.findOne({
    conversationId: toObjectId(conversationId),
    userId: toObjectId(userId),
    status: 'active',
  }));
}

export async function addParticipant(input: {
  conversationId: string | Types.ObjectId;
  userId: string | Types.ObjectId;
}) {
  const conversationId = toObjectId(input.conversationId);
  const userId = toObjectId(input.userId);

  return ConversationParticipant.findOneAndUpdate(
    { conversationId, userId },
    {
      $setOnInsert: {
        conversationId,
        userId,
        joinedAt: new Date(),
      },
      $set: { status: 'active' },
    },
    { upsert: true, new: true, runValidators: true }
  );
}

export async function createConversation(input: {
  actorId: string | Types.ObjectId;
  type: ConversationType;
  participantIds: Array<string | Types.ObjectId>;
  listingId?: string | Types.ObjectId;
  auctionListingId?: string | Types.ObjectId;
}) {
  await enforceConversationLimit(input.actorId);

  const actorId = toObjectId(input.actorId);
  const participantIds = Array.from(new Set([String(actorId), ...input.participantIds.map(String)]))
    .map((id) => toObjectId(id));

  const conversation = await Conversation.create({
    type: input.type,
    status: 'active',
    listingId: input.listingId ? toObjectId(input.listingId) : undefined,
    auctionListingId: input.auctionListingId ? toObjectId(input.auctionListingId) : undefined,
    createdBy: actorId,
  });

  await Promise.all(participantIds.map((userId) => addParticipant({ conversationId: conversation._id, userId })));
  await audit(String(actorId), messagingAuditActions.conversationCreated, conversation._id);

  return conversation;
}

export async function getOrCreateCommercialConversation(input: {
  listingId: string | Types.ObjectId;
  buyerId: string | Types.ObjectId;
}) {
  const listing = await Listing.findById(input.listingId);
  if (!listing || listing.status !== 'published') throw new Error('listing_not_found');

  const buyerId = toObjectId(input.buyerId);
  const sellerId = toObjectId(listing.seller);
  if (String(buyerId) === String(sellerId)) throw new Error('cannot_message_self');

  const existing = await Conversation.findOne({
    type: 'commercial',
    status: 'active',
    listingId: listing._id,
    createdBy: buyerId,
  }).sort({ createdAt: -1 });

  if (existing && await isConversationParticipant(existing._id, sellerId)) {
    return { conversation: existing, created: false };
  }

  const conversation = await createConversation({
    actorId: buyerId,
    type: 'commercial',
    listingId: listing._id,
    participantIds: [sellerId],
  });

  return { conversation, created: true };
}

export async function getConversationsForUser(userId: string | Types.ObjectId) {
  const participantRows = await ConversationParticipant.find({
    userId: toObjectId(userId),
    status: { $ne: 'removed' },
  }).select('conversationId').lean();

  return Conversation.find({
    _id: { $in: participantRows.map((row) => row.conversationId) },
    status: { $ne: 'deleted' },
  }).sort({ updatedAt: -1 }).lean();
}

export async function getConversationForParticipant(
  conversationId: string | Types.ObjectId,
  userId: string | Types.ObjectId
) {
  const conversationObjectId = toObjectId(conversationId);
  if (!await isConversationParticipant(conversationObjectId, userId)) {
    const error = new Error('forbidden');
    (error as any).status = 403;
    throw error;
  }

  const conversation = await Conversation.findOne({ _id: conversationObjectId, status: { $ne: 'deleted' } }).lean();
  if (!conversation) {
    const error = new Error('conversation_not_found');
    (error as any).status = 404;
    throw error;
  }
  return conversation;
}

export async function sendMessage(input: {
  conversationId: string | Types.ObjectId;
  senderId: string | Types.ObjectId;
  body: string;
}) {
  const conversationId = toObjectId(input.conversationId);
  const senderId = toObjectId(input.senderId);
  if (!await isActiveConversationParticipant(conversationId, senderId)) {
    const error = new Error('forbidden');
    (error as any).status = 403;
    throw error;
  }

  const body = String(input.body || '').trim();
  if (!body) throw new Error('message_body_required');

  const message = await Message.create({
    conversationId,
    senderId,
    type: 'text',
    status: 'active',
    body,
  });
  await Conversation.findByIdAndUpdate(conversationId, { $set: { updatedAt: new Date() } });
  await audit(String(senderId), messagingAuditActions.messageSent, conversationId);
  return message;
}

export async function sendSystemMessage(input: {
  conversationId: string | Types.ObjectId;
  body: string;
  source?: MessageSource;
  actorId?: string | Types.ObjectId;
}) {
  const conversationId = toObjectId(input.conversationId);
  if (input.actorId && !await isActiveConversationParticipant(conversationId, input.actorId)) {
    const error = new Error('forbidden');
    (error as any).status = 403;
    throw error;
  }

  const body = String(input.body || '').trim();
  if (!body) throw new Error('message_body_required');

  const message = await Message.create({
    conversationId,
    type: 'system',
    source: input.source || 'system',
    status: 'active',
    body,
  });
  await Conversation.findByIdAndUpdate(conversationId, { $set: { updatedAt: new Date() } });
  await audit(input.actorId ? String(input.actorId) : 'system', messagingAuditActions.systemMessageCreated, conversationId);
  return message;
}

export async function listMessagesForParticipant(
  conversationId: string | Types.ObjectId,
  userId: string | Types.ObjectId
) {
  await getConversationForParticipant(conversationId, userId);
  return Message.find({
    conversationId: toObjectId(conversationId),
    status: { $ne: 'deleted' },
  }).sort({ createdAt: 1 }).lean();
}

export async function archiveConversation(input: {
  conversationId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
}) {
  const conversation = await getConversationForParticipant(input.conversationId, input.actorId);
  const updated = await Conversation.findByIdAndUpdate(
    conversation._id,
    { $set: { status: 'archived' } },
    { new: true, runValidators: true }
  );
  await audit(String(input.actorId), messagingAuditActions.conversationArchived, toObjectId(conversation._id));
  return updated;
}

export async function closeConversation(input: {
  conversationId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
}) {
  const conversation = await getConversationForParticipant(input.conversationId, input.actorId);
  const updated = await Conversation.findByIdAndUpdate(
    conversation._id,
    { $set: { status: 'closed' } },
    { new: true, runValidators: true }
  );
  await audit(String(input.actorId), messagingAuditActions.conversationClosed, toObjectId(conversation._id));
  return updated;
}
