import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Audit } from '../../domain/audit/audit.model';
import { Animal } from '../../domain/animals/animal.model';
import { Breed } from '../../domain/breeds/breed.model';
import { Listing } from '../../domain/listings/listing.model';
import { MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { Conversation } from '../../domain/messaging/conversation.model';
import { ConversationParticipant } from '../../domain/messaging/conversationParticipant.model';
import { Message } from '../../domain/messaging/message.model';
import { Notification } from '../../domain/notifications/notification.model';
import {
  conversationDailyLimitsByPlan,
  createSystemMessageFromNotification,
  messagingAuditActions,
} from '../../domain/messaging/messaging.service';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createTestUser } from '../../test/helpers/factories';

describe('messaging routes', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  async function createPlan(code: 'free' | 'pro' | 'business') {
    return MembershipPlan.create({
      name: code,
      code,
      price: 0,
      currency: 'MXN',
      billingPeriod: 'manual',
      benefits: {
        maxActiveListings: 10,
        maxPhotosPerListing: 10,
        canUseFeaturedListings: true,
        includedFeaturedListings: 10,
        canAccessAuctions: true,
        canAccessMetrics: true,
        supportLevel: 'priority',
      },
      isActive: true,
      isPublic: true,
      sortOrder: 1,
    });
  }

  async function assignPlan(userId: Types.ObjectId, code: 'free' | 'pro' | 'business') {
    const plan = await createPlan(code);
    const now = new Date();
    return UserMembership.create({
      userId,
      planId: plan._id,
      status: 'active',
      startsAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      renewalMode: 'manual',
      source: 'manual',
      paymentProvider: 'none',
    });
  }

  async function createListingFor(sellerId: Types.ObjectId) {
    const suffix = new Types.ObjectId().toString();
    const breed = await Breed.create({ name: `Breed ${suffix}`, code: `B-${suffix.slice(-6)}` });
    const animal = await Animal.create({
      owner: sellerId,
      tag: `TAG-${suffix.slice(-8)}`,
      breed: breed._id,
      sex: 'M',
      location: { state: 'Sonora' },
    });

    return Listing.create({
      animal: animal._id,
      seller: sellerId,
      price: 1000,
      status: 'published',
    });
  }

  async function createConversationViaListing() {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const listing = await createListingFor(seller._id);
    const token = createAccessToken(buyer._id, 'user');

    const res = await request(app)
      .post('/messaging/conversations')
      .set('Authorization', bearer(token))
      .send({ listingId: String(listing._id) })
      .expect(201);

    return { seller, buyer, listing, token, conversation: res.body.conversation };
  }

  async function seedConversationCount(userId: Types.ObjectId, count: number) {
    if (count <= 0) return;
    await Conversation.insertMany(
      Array.from({ length: count }, () => ({
        type: 'support',
        status: 'active',
        createdBy: userId,
      }))
    );
  }

  it('creates a commercial conversation for listing contact', async () => {
    const { seller, buyer, listing, conversation } = await createConversationViaListing();

    expect(conversation.type).toBe('commercial');
    expect(conversation.status).toBe('active');
    expect(String(conversation.listingId)).toBe(String(listing._id));
    expect(String(conversation.createdBy)).toBe(String(buyer._id));

    const participants = await ConversationParticipant.find({ conversationId: conversation._id }).lean();
    expect(participants.map((p) => String(p.userId)).sort()).toEqual(
      [String(buyer._id), String(seller._id)].sort()
    );

    await expect(Audit.exists({
      action: messagingAuditActions.conversationCreated,
      conversationId: conversation._id,
      actor: String(buyer._id),
    })).resolves.toBeTruthy();
  });

  it('lists only conversations where the user participates', async () => {
    const { buyer, token, conversation } = await createConversationViaListing();
    const other = await createTestUser('user');
    const otherConversation = await Conversation.create({
      type: 'support',
      status: 'active',
      createdBy: other._id,
    });
    await ConversationParticipant.create({ conversationId: otherConversation._id, userId: other._id });

    const res = await request(app)
      .get('/messaging/conversations')
      .set('Authorization', bearer(token))
      .expect(200);

    expect(res.body).toMatchObject({ page: 1, limit: 20, total: 1 });
    expect(res.body.conversations.map((item: any) => String(item._id))).toEqual([String(conversation._id)]);
    expect(res.body.conversations.every((item: any) => String(item.createdBy) === String(buyer._id))).toBe(true);
  });

  it('reuses an existing active commercial conversation for same listing buyer and seller', async () => {
    const { listing, token, conversation } = await createConversationViaListing();

    const reused = await request(app)
      .post('/messaging/conversations')
      .set('Authorization', bearer(token))
      .send({ listingId: String(listing._id) })
      .expect(200);

    expect(reused.body.created).toBe(false);
    expect(String(reused.body.conversation._id)).toBe(String(conversation._id));
    expect(await Conversation.countDocuments()).toBe(1);
  });

  it('archives and closes conversations for participants', async () => {
    const { token, conversation } = await createConversationViaListing();

    const archived = await request(app)
      .post(`/messaging/conversations/${conversation._id}/archive`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(archived.body.status).toBe('archived');

    const closed = await request(app)
      .post(`/messaging/conversations/${conversation._id}/close`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(closed.body.status).toBe('closed');

    await expect(Audit.exists({ action: messagingAuditActions.conversationArchived })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: messagingAuditActions.conversationClosed })).resolves.toBeTruthy();
  });

  it('allows participants to read a conversation and blocks outsiders', async () => {
    const { token, conversation } = await createConversationViaListing();
    const outsider = await createTestUser('user');

    await request(app)
      .get(`/messaging/conversations/${conversation._id}`)
      .set('Authorization', bearer(token))
      .expect(200);

    await request(app)
      .get(`/messaging/conversations/${conversation._id}`)
      .set('Authorization', bearer(createAccessToken(outsider._id, 'user')))
      .expect(403);
  });

  it('sends and lists text messages for active participants', async () => {
    const { buyer, seller, token, conversation } = await createConversationViaListing();

    const sent = await request(app)
      .post(`/messaging/conversations/${conversation._id}/messages`)
      .set('Authorization', bearer(token))
      .send({ body: 'Me interesa esta publicacion.' })
      .expect(201);

    expect(sent.body.type).toBe('text');
    expect(String(sent.body.senderId)).toBe(String(buyer._id));

    const updatedConversation = await Conversation.findById(conversation._id).lean();
    expect(updatedConversation?.firstMessageAt).toBeTruthy();
    expect(updatedConversation?.lastMessageAt).toBeTruthy();
    expect(String(updatedConversation?.lastMessageId)).toBe(String(sent.body._id));
    expect(updatedConversation?.messageCount).toBe(1);
    expect(updatedConversation?.lastMessagePreview).toBe('Me interesa esta publicacion.');

    const buyerParticipant = await ConversationParticipant.findOne({
      conversationId: conversation._id,
      userId: buyer._id,
    }).lean();
    const sellerParticipant = await ConversationParticipant.findOne({
      conversationId: conversation._id,
      userId: seller._id,
    }).lean();
    expect(buyerParticipant?.unreadCount).toBe(0);
    expect(sellerParticipant?.unreadCount).toBe(1);

    const listed = await request(app)
      .get(`/messaging/conversations/${conversation._id}/messages`)
      .set('Authorization', bearer(token))
      .expect(200);

    expect(listed.body).toMatchObject({ page: 1, limit: 20, total: 1 });
    expect(listed.body.messages[0].body).toBe('Me interesa esta publicacion.');
    await expect(Audit.exists({ action: messagingAuditActions.messageSent })).resolves.toBeTruthy();
  });

  it('creates deduplicated system messages with sanitized metadata', async () => {
    const { token, conversation } = await createConversationViaListing();

    const sent = await request(app)
      .post(`/messaging/conversations/${conversation._id}/messages`)
      .set('Authorization', bearer(token))
      .send({
        type: 'system',
        source: 'system',
        body: 'Conversacion iniciada.',
        eventKey: 'conversation-started',
        metadata: {
          notificationId: 'notif_1',
          token: 'secret-token',
          payload: { raw: true },
        },
      })
      .expect(201);

    expect(sent.body.type).toBe('system');
    expect(sent.body.senderId).toBeUndefined();
    expect(sent.body.eventKey).toBe('conversation-started');
    expect(sent.body.metadata).toEqual({ notificationId: 'notif_1' });

    const duplicate = await request(app)
      .post(`/messaging/conversations/${conversation._id}/messages`)
      .set('Authorization', bearer(token))
      .send({
        type: 'system',
        source: 'system',
        body: 'Duplicado',
        eventKey: 'conversation-started',
      })
      .expect(201);

    expect(String(duplicate.body._id)).toBe(String(sent.body._id));
    expect(await Message.countDocuments({ type: 'system' })).toBe(1);
    await expect(Audit.exists({ action: messagingAuditActions.systemMessageCreated })).resolves.toBeTruthy();
  });

  it('marks a participant conversation as read and blocks outsiders', async () => {
    const { seller, token, conversation } = await createConversationViaListing();
    const outsider = await createTestUser('user');

    await request(app)
      .post(`/messaging/conversations/${conversation._id}/messages`)
      .set('Authorization', bearer(token))
      .send({ body: 'Mensaje para lectura.' })
      .expect(201);

    const read = await request(app)
      .post(`/messaging/conversations/${conversation._id}/read`)
      .set('Authorization', bearer(createAccessToken(seller._id, 'user')))
      .expect(200);

    expect(read.body.unreadCount).toBe(0);
    expect(read.body.lastReadAt).toBeTruthy();
    expect(read.body.lastSeenMessageAt).toBeTruthy();
    await expect(Audit.exists({ action: messagingAuditActions.messageRead })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: messagingAuditActions.conversationRead })).resolves.toBeTruthy();

    await request(app)
      .post(`/messaging/conversations/${conversation._id}/read`)
      .set('Authorization', bearer(createAccessToken(outsider._id, 'user')))
      .expect(403);
  });

  it('orders conversations by latest activity and paginates messages oldest first', async () => {
    const first = await createConversationViaListing();
    const second = await createConversationViaListing();

    await request(app)
      .post(`/messaging/conversations/${first.conversation._id}/messages`)
      .set('Authorization', bearer(first.token))
      .send({ body: 'Primer mensaje.' })
      .expect(201);
    await request(app)
      .post(`/messaging/conversations/${second.conversation._id}/messages`)
      .set('Authorization', bearer(second.token))
      .send({ body: 'Mensaje mas reciente.' })
      .expect(201);

    const conversations = await request(app)
      .get('/messaging/conversations?page=1&limit=1')
      .set('Authorization', bearer(second.token))
      .expect(200);

    expect(conversations.body).toMatchObject({ page: 1, limit: 1, total: 1 });
    expect(String(conversations.body.conversations[0]._id)).toBe(String(second.conversation._id));
    expect(conversations.body.conversations[0]).toMatchObject({
      messageCount: 1,
      lastMessagePreview: 'Mensaje mas reciente.',
      unreadCount: 0,
    });

    await request(app)
      .post(`/messaging/conversations/${second.conversation._id}/messages`)
      .set('Authorization', bearer(second.token))
      .send({ body: 'Segundo mensaje.' })
      .expect(201);

    const messages = await request(app)
      .get(`/messaging/conversations/${second.conversation._id}/messages?page=1&limit=1`)
      .set('Authorization', bearer(second.token))
      .expect(200);

    expect(messages.body).toMatchObject({ page: 1, limit: 1, total: 2 });
    expect(messages.body.messages[0].body).toBe('Mensaje mas reciente.');
  });

  it('supports notification-to-system-message helper without deleting notification records', async () => {
    const { buyer, conversation } = await createConversationViaListing();
    const notification = await Notification.create({
      userId: buyer._id,
      type: 'membership_recovered',
      title: 'Actualizacion',
      message: 'Tu conversacion fue actualizada',
    });

    const message = await createSystemMessageFromNotification({
      conversationId: conversation._id,
      title: notification.title,
      message: notification.message,
      eventKey: `notification:${notification._id}`,
      metadata: { notificationId: String(notification._id), secret: 'hidden' },
    });

    expect(message.type).toBe('system');
    expect(message.metadata).toEqual({ notificationId: String(notification._id) });
    await expect(Notification.exists({ _id: notification._id })).resolves.toBeTruthy();
  });

  it('blocks non participants from sending and listing messages', async () => {
    const { conversation } = await createConversationViaListing();
    const outsider = await createTestUser('user');
    const outsiderToken = createAccessToken(outsider._id, 'user');

    await request(app)
      .post(`/messaging/conversations/${conversation._id}/messages`)
      .set('Authorization', bearer(outsiderToken))
      .send({ body: 'No deberia entrar.' })
      .expect(403);

    await request(app)
      .get(`/messaging/conversations/${conversation._id}/messages`)
      .set('Authorization', bearer(outsiderToken))
      .expect(403);
  });

  it('blocks removed participants from sending messages', async () => {
    const { buyer, token, conversation } = await createConversationViaListing();
    await ConversationParticipant.updateOne(
      { conversationId: conversation._id, userId: buyer._id },
      { $set: { status: 'removed' } }
    );

    await request(app)
      .post(`/messaging/conversations/${conversation._id}/messages`)
      .set('Authorization', bearer(token))
      .send({ body: 'No activo.' })
      .expect(403);
  });

  it.each([
    ['free', conversationDailyLimitsByPlan.free],
    ['pro', conversationDailyLimitsByPlan.pro],
    ['business', conversationDailyLimitsByPlan.business],
  ] as const)('enforces %s daily new conversation limit', async (planCode, limit) => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    await assignPlan(buyer._id, planCode);
    const listing = await createListingFor(seller._id);
    await seedConversationCount(buyer._id, limit);

    const res = await request(app)
      .post('/messaging/conversations')
      .set('Authorization', bearer(createAccessToken(buyer._id, 'user')))
      .send({ listingId: String(listing._id) });

    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: 'conversation_daily_limit_reached',
      limit,
      plan: planCode,
    });
  });
});
