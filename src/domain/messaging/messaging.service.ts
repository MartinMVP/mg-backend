import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { Listing } from '../listings/listing.model';
import { getUserMembership } from '../memberships/membership.service';
import { Conversation, ConversationStatus, ConversationType } from './conversation.model';
import { ConversationParticipant } from './conversationParticipant.model';
import { Message, MessageSource } from './message.model';
import { getConfigValue } from '../platformConfiguration/platformConfiguration.service';

export const messagingAuditActions = {
  conversationCreated: 'CONVERSATION_CREATED',
  messageSent: 'MESSAGE_SENT',
  messageRead: 'MESSAGE_READ',
  conversationRead: 'CONVERSATION_READ',
  conversationArchived: 'CONVERSATION_ARCHIVED',
  conversationClosed: 'CONVERSATION_CLOSED',
  systemMessageCreated: 'SYSTEM_MESSAGE_CREATED',
} as const;

export const conversationDailyLimitsByPlan = {
  free: 10,
  pro: 50,
  business: 1000,
} as const;

const defaultPage = 1;
const defaultLimit = 20;
const maxLimit = 100;
const previewMaxLength = 160;
const sensitiveMetadataKey = /(secret|token|password|authorization|cookie|payload|raw|api[-_]?key|private[-_]?key)/i;

type PaginationInput = {
  page?: unknown;
  limit?: unknown;
};

type ConversationFilters = PaginationInput & {
  status?: ConversationStatus;
  type?: ConversationType;
};

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

function normalizePagination(input: PaginationInput = {}) {
  const parsedPage = Number(input.page);
  const parsedLimit = Number(input.limit);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : defaultPage;
  const limit = Number.isFinite(parsedLimit) && parsedLimit >= 1
    ? Math.min(Math.floor(parsedLimit), maxLimit)
    : defaultLimit;

  return { page, limit, skip: (page - 1) * limit };
}

function safePreview(body: string) {
  const preview = String(body || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return preview.length > previewMaxLength ? `${preview.slice(0, previewMaxLength - 1).trimEnd()}...` : preview;
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.slice(0, 500);
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => sanitizeMetadataValue(item))
      .filter((item) => item !== undefined);
  }
  if (typeof value === 'object') return '[object]';
  return undefined;
}

function sanitizeMetadata(metadata?: Record<string, unknown>) {
  if (!metadata) return undefined;
  if (typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('metadata_invalid');

  const sanitized = Object.entries(metadata).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (!key || sensitiveMetadataKey.test(key)) return acc;
    const sanitizedValue = sanitizeMetadataValue(value);
    if (sanitizedValue !== undefined) acc[key] = sanitizedValue;
    return acc;
  }, {});

  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

async function audit(actor: string, action: string, conversationId: Types.ObjectId) {
  await Audit.create({ actor, action, conversationId });
}

async function enforceConversationLimit(userId: string | Types.ObjectId) {
  const { plan } = await getUserMembership(userId);
  const planCode = normalizePlanCode(plan?.code);
  const configuredLimit = await getConfigValue(
    `messaging.${planCode}.dailyConversationLimit`,
    'sandbox',
    conversationDailyLimitsByPlan[planCode]
  );
  const limit = Number(configuredLimit);
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

async function assertParticipant(conversationId: Types.ObjectId, userId: string | Types.ObjectId) {
  const participant = await ensureParticipant(conversationId, toObjectId(userId));
  if (!participant) {
    const error = new Error('forbidden');
    (error as any).status = 403;
    throw error;
  }
  return participant;
}

async function updateConversationAfterMessage(input: {
  conversationId: Types.ObjectId;
  messageId: Types.ObjectId;
  body: string;
  createdAt: Date;
  senderId?: Types.ObjectId;
}) {
  const conversation = await Conversation.findById(input.conversationId).select('firstMessageAt').lean();
  const set: Record<string, unknown> = {
    lastMessageAt: input.createdAt,
    lastMessageId: input.messageId,
    lastMessagePreview: safePreview(input.body),
    updatedAt: new Date(),
  };
  if (!conversation?.firstMessageAt) set.firstMessageAt = input.createdAt;

  await Conversation.findByIdAndUpdate(input.conversationId, {
    $set: set,
    $inc: { messageCount: 1 },
  });

  const participantQuery: Record<string, unknown> = {
    conversationId: input.conversationId,
    status: 'active',
  };
  if (input.senderId) participantQuery.userId = { $ne: input.senderId };

  await ConversationParticipant.updateMany(participantQuery, { $inc: { unreadCount: 1 } });
}

function withParticipantContext(conversation: any, participant: any, participants?: any[]) {
  return {
    ...conversation,
    unreadCount: participant?.unreadCount ?? 0,
    participants,
  };
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
        unreadCount: 0,
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
    messageCount: 0,
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

export async function getConversationsForUser(userId: string | Types.ObjectId, filters: ConversationFilters = {}) {
  const pagination = normalizePagination(filters);
  const participantRows = await ConversationParticipant.find({
    userId: toObjectId(userId),
    status: { $ne: 'removed' },
  }).select('conversationId unreadCount').lean();
  const unreadByConversation = new Map(participantRows.map((row) => [String(row.conversationId), row.unreadCount || 0]));
  const query: Record<string, unknown> = {
    _id: { $in: participantRows.map((row) => row.conversationId) },
    status: { $ne: 'deleted' },
  };

  if (filters.status) query.status = filters.status;
  if (filters.type) query.type = filters.type;

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
      unreadCount: unreadByConversation.get(String(conversation._id)) || 0,
    })),
  };
}

export async function getConversationForParticipant(
  conversationId: string | Types.ObjectId,
  userId: string | Types.ObjectId
) {
  const conversationObjectId = toObjectId(conversationId);
  const participant = await assertParticipant(conversationObjectId, userId);

  const [conversation, participants] = await Promise.all([
    Conversation.findOne({ _id: conversationObjectId, status: { $ne: 'deleted' } }).lean(),
    ConversationParticipant.find({ conversationId: conversationObjectId }).lean(),
  ]);
  if (!conversation) {
    const error = new Error('conversation_not_found');
    (error as any).status = 404;
    throw error;
  }
  return withParticipantContext(conversation, participant, participants);
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
  await updateConversationAfterMessage({
    conversationId,
    senderId,
    messageId: message._id,
    body,
    createdAt: message.createdAt,
  });
  await audit(String(senderId), messagingAuditActions.messageSent, conversationId);
  return message;
}

export async function sendSystemMessage(input: {
  conversationId: string | Types.ObjectId;
  body: string;
  source?: MessageSource;
  actorId?: string | Types.ObjectId;
  eventKey?: string;
  metadata?: Record<string, unknown>;
}) {
  const conversationId = toObjectId(input.conversationId);
  if (input.actorId && !await isActiveConversationParticipant(conversationId, input.actorId)) {
    const error = new Error('forbidden');
    (error as any).status = 403;
    throw error;
  }

  const body = String(input.body || '').trim();
  if (!body) throw new Error('message_body_required');

  const eventKey = input.eventKey ? String(input.eventKey).trim() : undefined;
  if (eventKey) {
    const existing = await Message.findOne({ conversationId, type: 'system', eventKey });
    if (existing) return existing;
  }

  try {
    const message = await Message.create({
      conversationId,
      type: 'system',
      source: input.source || 'system',
      status: 'active',
      body,
      eventKey,
      metadata: sanitizeMetadata(input.metadata),
    });
    await updateConversationAfterMessage({
      conversationId,
      messageId: message._id,
      body,
      createdAt: message.createdAt,
    });
    await audit(
      input.actorId ? String(input.actorId) : 'system',
      messagingAuditActions.systemMessageCreated,
      conversationId
    );
    return message;
  } catch (error) {
    if ((error as any)?.code === 11000 && eventKey) {
      const existing = await Message.findOne({ conversationId, type: 'system', eventKey });
      if (existing) return existing;
    }
    throw error;
  }
}

export async function createSystemMessageFromNotification(input: {
  conversationId: string | Types.ObjectId;
  title?: string;
  message?: string;
  source?: MessageSource;
  eventKey?: string;
  metadata?: Record<string, unknown>;
}) {
  const body = [input.title, input.message].filter(Boolean).join(': ');
  return sendSystemMessage({
    conversationId: input.conversationId,
    source: input.source || 'system',
    body,
    eventKey: input.eventKey,
    metadata: input.metadata,
  });
}

export async function markConversationRead(input: {
  conversationId: string | Types.ObjectId;
  userId: string | Types.ObjectId;
}) {
  const conversationId = toObjectId(input.conversationId);
  const userId = toObjectId(input.userId);
  const participant = await assertParticipant(conversationId, userId);
  const conversation = await Conversation.findOne({ _id: conversationId, status: { $ne: 'deleted' } })
    .select('lastMessageAt')
    .lean();
  if (!conversation) {
    const error = new Error('conversation_not_found');
    (error as any).status = 404;
    throw error;
  }

  const now = new Date();
  const updated = await ConversationParticipant.findByIdAndUpdate(
    participant._id,
    {
      $set: {
        unreadCount: 0,
        lastReadAt: now,
        lastSeenMessageAt: conversation.lastMessageAt || now,
      },
    },
    { new: true, runValidators: true }
  );
  await audit(String(userId), messagingAuditActions.messageRead, conversationId);
  await audit(String(userId), messagingAuditActions.conversationRead, conversationId);
  return updated;
}

export async function listMessagesForParticipant(
  conversationId: string | Types.ObjectId,
  userId: string | Types.ObjectId,
  paginationInput: PaginationInput = {}
) {
  await getConversationForParticipant(conversationId, userId);
  const conversationObjectId = toObjectId(conversationId);
  const pagination = normalizePagination(paginationInput);
  const query = {
    conversationId: conversationObjectId,
    status: { $ne: 'deleted' },
  };
  const [total, messages] = await Promise.all([
    Message.countDocuments(query),
    Message.find(query).sort({ createdAt: 1 }).skip(pagination.skip).limit(pagination.limit).lean(),
  ]);

  return {
    page: pagination.page,
    limit: pagination.limit,
    total,
    messages,
  };
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
