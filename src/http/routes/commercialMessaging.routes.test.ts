import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { Animal } from '../../domain/animals/animal.model';
import { Breed } from '../../domain/breeds/breed.model';
import { Conversation } from '../../domain/messaging/conversation.model';
import { ConversationParticipant } from '../../domain/messaging/conversationParticipant.model';
import { Message } from '../../domain/messaging/message.model';
import { Listing } from '../../domain/listings/listing.model';
import { MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { Notification } from '../../domain/notifications/notification.model';
import { bearer } from '../../test/helpers/auth';
import { createTestUser } from '../../test/helpers/factories';
import { signAccessToken } from '../../utils/jwt';

function tokenFor(user: any, role: 'user' | 'admin' | 'super' = user.role || 'user') {
  return signAccessToken({ sub: String(user._id), role, typ: 'access' });
}

async function createPublishedListing(seller: any) {
  const suffix = new Types.ObjectId().toString();
  const breed = await Breed.create({ name: `Breed ${suffix}`, code: `B-${suffix.slice(-6)}` });
  const animal = await Animal.create({
    owner: seller._id,
    tag: `TAG-${suffix.slice(-8)}`,
    breed: breed._id,
    sex: 'M',
    location: { state: 'Sonora' },
  });
  return Listing.create({
    animal: animal._id,
    seller: seller._id,
    title: 'Toro comercial',
    price: 25000,
    currency: 'MXN',
    status: 'published',
    publishedAt: new Date(),
  });
}

async function createPendingMembership(user: any) {
  const plan = await MembershipPlan.create({
    code: `pending-${new Types.ObjectId().toString().slice(-6)}`,
    name: 'Pending',
    monthlyPrice: 0,
    yearlyPrice: 0,
    durationDays: 30,
    price: 0,
    currency: 'MXN',
    billingPeriod: 'manual',
    benefits: {
      maxActiveListings: 1,
      maxPhotosPerListing: 1,
      canUseFeaturedListings: false,
      includedFeaturedListings: 0,
      canAccessAuctions: false,
      canAccessMetrics: false,
      supportLevel: 'basic',
    },
    limits: { animalListings: 1 },
    isActive: true,
  });
  const now = new Date();
  return UserMembership.create({
    userId: user._id,
    planId: plan._id,
    status: 'pending_activation',
    startsAt: now,
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    renewalMode: 'manual',
    source: 'admin',
    paymentProvider: 'none',
  });
}

describe('Capability 13.4 Comunicacion Comercial', () => {
  it('creates a contextual listing conversation and reuses the active conversation idempotently', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const listing = await createPublishedListing(seller);

    const first = await request(app)
      .post('/messages/conversations')
      .set('Authorization', bearer(tokenFor(buyer)))
      .send({ listingId: String(listing._id) })
      .expect(201);

    expect(first.body.conversation.type).toBe('listing');
    expect(String(first.body.conversation.listingId)).toBe(String(listing._id));
    expect(String(first.body.conversation.sellerId)).toBe(String(seller._id));
    expect(String(first.body.conversation.buyerId)).toBe(String(buyer._id));
    expect(await ConversationParticipant.countDocuments({ conversationId: first.body.conversation._id })).toBe(2);
    expect(await Notification.exists({ userId: seller._id, type: 'conversation_created' })).toBeTruthy();

    const second = await request(app)
      .post('/messages/conversations')
      .set('Authorization', bearer(tokenFor(buyer)))
      .send({ listingId: String(listing._id) })
      .expect(200);
    expect(second.body.conversation._id).toBe(first.body.conversation._id);
    expect(await Conversation.countDocuments({ type: 'listing', listingId: listing._id, buyerId: buyer._id })).toBe(1);
  });

  it('rejects missing listing, unpublished listing, self contact and non-participant access', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const outsider = await createTestUser('user');
    const listing = await createPublishedListing(seller);
    await Listing.findByIdAndUpdate(listing._id, { $set: { status: 'draft' } });

    await request(app).post('/messages/conversations').set('Authorization', bearer(tokenFor(buyer))).send({}).expect(400);
    await request(app).post('/messages/conversations').set('Authorization', bearer(tokenFor(buyer))).send({ listingId: String(listing._id) }).expect(404);

    await Listing.findByIdAndUpdate(listing._id, { $set: { status: 'published' } });
    await request(app).post('/messages/conversations').set('Authorization', bearer(tokenFor(seller))).send({ listingId: String(listing._id) }).expect(400);

    const created = await request(app).post('/messages/conversations').set('Authorization', bearer(tokenFor(buyer))).send({ listingId: String(listing._id) }).expect(201);
    await request(app).get(`/messages/conversations/${created.body.conversation._id}`).set('Authorization', bearer(tokenFor(outsider))).expect(403);
    await request(app).post(`/messages/conversations/${created.body.conversation._id}/messages`).set('Authorization', bearer(tokenFor(outsider))).send({ body: 'Hola' }).expect(403);
  });

  it('validates membership only when creating the conversation and does not revalidate per message', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const listing = await createPublishedListing(seller);
    await createPendingMembership(buyer);

    await request(app)
      .post('/messages/conversations')
      .set('Authorization', bearer(tokenFor(buyer)))
      .send({ listingId: String(listing._id) })
      .expect(409);

    await UserMembership.findOneAndUpdate({ userId: buyer._id }, { $set: { status: 'active' } });
    const created = await request(app)
      .post('/messages/conversations')
      .set('Authorization', bearer(tokenFor(buyer)))
      .send({ listingId: String(listing._id) })
      .expect(201);

    await UserMembership.findOneAndUpdate({ userId: buyer._id }, { $set: { status: 'suspended' } });
    await request(app)
      .post(`/messages/conversations/${created.body.conversation._id}/messages`)
      .set('Authorization', bearer(tokenFor(buyer)))
      .send({ body: 'Sigue disponible?' })
      .expect(201);
  });

  it('sends messages, returns immutable history, archives and closes the conversation', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const listing = await createPublishedListing(seller);
    const created = await request(app)
      .post('/messages/conversations')
      .set('Authorization', bearer(tokenFor(buyer)))
      .send({ listingId: String(listing._id) })
      .expect(201);
    const conversationId = created.body.conversation._id;

    await request(app)
      .post(`/messages/conversations/${conversationId}/messages`)
      .set('Authorization', bearer(tokenFor(buyer)))
      .send({ type: 'system', body: 'No permitido.', eventKey: 'forbidden-system' })
      .expect(403)
      .expect((res) => {
        expect(res.body.error).toBe('system_message_forbidden');
      });
    expect(await Message.countDocuments({ conversationId, type: 'system' })).toBe(0);

    const buyerMessage = await request(app)
      .post(`/messages/conversations/${conversationId}/messages`)
      .set('Authorization', bearer(tokenFor(buyer)))
      .send({ body: 'Me interesa el animal.' })
      .expect(201);
    await request(app)
      .post(`/messages/conversations/${conversationId}/messages`)
      .set('Authorization', bearer(tokenFor(seller)))
      .send({ body: 'Sigue disponible.' })
      .expect(201);

    const history = await request(app)
      .get(`/messages/conversations/${conversationId}`)
      .set('Authorization', bearer(tokenFor(buyer)))
      .expect(200);
    expect(history.body.messages.total).toBe(2);
    expect(history.body.messages.items.map((message: any) => message.body)).toEqual(['Me interesa el animal.', 'Sigue disponible.']);
    expect(await Notification.exists({ userId: seller._id, type: 'message_received' })).toBeTruthy();
    expect(await Notification.exists({ userId: buyer._id, type: 'message_received' })).toBeTruthy();

    await expect(Message.findByIdAndUpdate(buyerMessage.body._id, { $set: { body: 'editado' } })).rejects.toThrow('message_immutable');
    expect((await Message.findById(buyerMessage.body._id).lean())?.body).toBe('Me interesa el animal.');

    const archived = await request(app)
      .patch(`/messages/conversations/${conversationId}/archive`)
      .set('Authorization', bearer(tokenFor(buyer)))
      .expect(200);
    expect(archived.body.status).toBe('archived');
    expect(archived.body.archivedAt).toBeTruthy();

    const closed = await request(app)
      .patch(`/messages/conversations/${conversationId}/close`)
      .set('Authorization', bearer(tokenFor(seller)))
      .expect(200);
    expect(closed.body.status).toBe('closed');
    expect(closed.body.closedAt).toBeTruthy();

    await request(app)
      .post(`/messages/conversations/${conversationId}/messages`)
      .set('Authorization', bearer(tokenFor(buyer)))
      .send({ body: 'Otro mensaje' })
      .expect(409);
  });

  it('records audit events and exposes commercial messaging metrics without sensitive conversation payloads', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const admin = await createTestUser('admin');
    const listing = await createPublishedListing(seller);
    const created = await request(app).post('/messages/conversations').set('Authorization', bearer(tokenFor(buyer))).send({ listingId: String(listing._id) }).expect(201);
    await request(app).post(`/messages/conversations/${created.body.conversation._id}/messages`).set('Authorization', bearer(tokenFor(buyer))).send({ body: 'Hola' }).expect(201);
    await request(app).patch(`/messages/conversations/${created.body.conversation._id}/archive`).set('Authorization', bearer(tokenFor(buyer))).expect(200);
    await request(app).patch(`/messages/conversations/${created.body.conversation._id}/close`).set('Authorization', bearer(tokenFor(buyer))).expect(200);

    expect(await Audit.exists({ actor: String(buyer._id), action: 'CONVERSATION_CREATED' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(buyer._id), action: 'MESSAGE_SENT' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(buyer._id), action: 'CONVERSATION_ARCHIVED' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(buyer._id), action: 'CONVERSATION_CLOSED' })).toBeTruthy();

    const dashboard = await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .expect(200);
    expect(dashboard.body.commercialMessaging.conversationsCreated).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.commercialMessaging.messagesSent).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.commercialMessaging.conversationsArchived).toBeGreaterThanOrEqual(0);
    expect(dashboard.body.commercialMessaging.conversationsClosed).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.commercialMessaging).not.toHaveProperty('messages');
  });

  it('keeps Marketplace, Membership, Revenue, Fiscal, AOE and Knowledge surfaces compatible', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const admin = await createTestUser('admin');
    const listing = await createPublishedListing(seller);
    await request(app).get(`/catalog/listings/${listing._id}`).expect(200);
    await request(app).post('/messages/conversations').set('Authorization', bearer(tokenFor(buyer))).send({ listingId: String(listing._id) }).expect(201);
    await request(app).get('/account/membership').set('Authorization', bearer(tokenFor(buyer))).expect(200);
    await request(app).get('/admin/payments/records').set('Authorization', bearer(tokenFor(admin, 'admin'))).expect(200);
    await request(app).get('/admin/fiscal/transactions').set('Authorization', bearer(tokenFor(admin, 'admin'))).expect(200);

    const dashboard = await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .expect(200);
    expect(dashboard.body.aoe).toBeDefined();
    expect(dashboard.body.knowledgeFoundation).toBeDefined();
    expect(dashboard.body.commercialMessaging).toBeDefined();
  });
});
