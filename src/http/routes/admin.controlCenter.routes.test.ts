import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../../app';
import {
  adminControlCenterAlertActions,
  adminControlCenterAuditActions,
} from '../../domain/admin/adminControlCenter.service';
import { Audit } from '../../domain/audit/audit.model';
import { Auction } from '../../domain/auctions/auction.model';
import { Listing } from '../../domain/listings/listing.model';
import { MembershipPlan, MembershipBenefits } from '../../domain/memberships/membershipPlan.model';
import { MembershipChangeLog } from '../../domain/memberships/membershipChangeLog.model';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { Conversation } from '../../domain/messaging/conversation.model';
import { ConversationParticipant } from '../../domain/messaging/conversationParticipant.model';
import { Message } from '../../domain/messaging/message.model';
import { Notification } from '../../domain/notifications/notification.model';
import { DunningState } from '../../domain/payments/dunningState.model';
import { PaymentCheckoutSession } from '../../domain/payments/paymentCheckoutSession.model';
import { PaymentRecord } from '../../domain/payments/paymentRecord.model';
import { PaymentWebhookLog } from '../../domain/payments/paymentWebhookLog.model';
import { bearer } from '../../test/helpers/auth';
import { createTestListing, createTestUser } from '../../test/helpers/factories';
import { signAccessToken } from '../../utils/jwt';

const benefits: MembershipBenefits = {
  maxActiveListings: 3,
  maxPhotosPerListing: 5,
  canUseFeaturedListings: false,
  includedFeaturedListings: 0,
  canAccessAuctions: false,
  canAccessMetrics: false,
  supportLevel: 'basic',
};

function tokenFor(user: any, role = user.role) {
  return signAccessToken({ sub: String(user._id), role, typ: 'access' });
}

async function adminContext(role: 'admin' | 'super' = 'admin') {
  const user = await createTestUser(role);
  return { user, token: tokenFor(user, role) };
}

async function createPlan(code: string, price = 0) {
  return MembershipPlan.create({
    name: `Control ${code}`,
    code,
    price,
    currency: 'MXN',
    billingPeriod: price > 0 ? 'monthly' : 'manual',
    benefits,
    isActive: true,
    isPublic: true,
    sortOrder: price,
    stripePriceId: price > 0 ? `price_${code}` : undefined,
  });
}

async function createMembership(user: any, plan: any, status = 'active') {
  const now = new Date();
  return UserMembership.create({
    userId: user._id,
    planId: plan._id,
    status,
    startsAt: now,
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    renewalMode: 'manual',
    source: 'admin',
    paymentProvider: 'none',
  });
}

async function setCreatedAt(model: any, id: any, createdAt: string) {
  await model.updateOne({ _id: id }, { $set: { createdAt: new Date(createdAt), updatedAt: new Date(createdAt) } });
}

describe('admin control center', () => {
  it('requires admin role for control center endpoints', async () => {
    const regular = await createTestUser('user');
    const admin = await adminContext('admin');
    const superAdmin = await adminContext('super');

    await request(app).get('/admin/control-center/dashboard').expect(401);
    await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(tokenFor(regular)))
      .expect(403);

    await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(admin.token))
      .expect(200);

    await request(app)
      .get('/admin/control-center/alerts')
      .set('Authorization', bearer(superAdmin.token))
      .expect(200);
  });

  it('returns dashboard sections with safe aggregate metrics and records view audit', async () => {
    const { token } = await adminContext();
    const free = await createPlan('free');
    const pro = await createPlan('pro', 499);
    const freeUser = await createTestUser();
    const paidUser = await createTestUser();
    const dunningUser = await createTestUser();
    await createMembership(freeUser, free, 'active');
    await createMembership(paidUser, pro, 'active');
    const dunningMembership = await createMembership(dunningUser, pro, 'in_dunning');
    await UserMembership.updateOne({ _id: dunningMembership._id }, { $set: { cancelAtPeriodEnd: true } });

    const listing = await createTestListing(paidUser._id);
    await Listing.updateOne({ _id: listing._id }, { $set: { featured: true, status: 'published' } });
    await Auction.create({
      title: 'Dashboard auction',
      listing: listing._id,
      state: 'live',
      startsAt: new Date(Date.now() - 60_000),
      endsAt: new Date(Date.now() + 60_000),
      startPrice: 1000,
      minIncrement: 100,
      currentPrice: 1000,
      antiSnipingSec: 30,
      antiSnipingExtendSec: 20,
      antiSnipingMaxExt: 3,
      antiSnipingCount: 0,
    });
    await PaymentCheckoutSession.create({
      userId: paidUser._id,
      membershipPlanId: pro._id,
      provider: 'stripe',
      providerEnvironment: 'sandbox',
      checkoutRequestId: 'checkout-control-center',
      mode: 'subscription',
      status: 'open',
      amount: pro.price,
      currency: 'MXN',
    });
    await PaymentRecord.create({
      userId: paidUser._id,
      membershipPlanId: pro._id,
      provider: 'stripe',
      providerEnvironment: 'sandbox',
      providerPaymentId: 'pi_control_success',
      providerInvoiceId: 'in_control_success',
      type: 'membership',
      status: 'succeeded',
      amount: pro.price,
      currency: 'MXN',
      paidAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await PaymentRecord.create({
      userId: dunningUser._id,
      membershipPlanId: pro._id,
      provider: 'stripe',
      providerEnvironment: 'sandbox',
      providerPaymentId: 'pi_control_failed',
      providerInvoiceId: 'in_control_failed',
      type: 'membership',
      status: 'failed',
      amount: pro.price,
      currency: 'MXN',
    });
    await DunningState.create({
      userId: dunningUser._id,
      userMembershipId: dunningMembership._id,
      status: 'active',
      failedAt: new Date(),
      retrySchedule: [],
    });
    const activeConversation = await Conversation.create({
      type: 'commercial',
      status: 'active',
      listingId: listing._id,
      createdBy: paidUser._id,
    });
    await Conversation.create({ type: 'support', status: 'archived', createdBy: freeUser._id });
    await Conversation.create({ type: 'system', status: 'closed', createdBy: dunningUser._id });
    await ConversationParticipant.create({
      conversationId: activeConversation._id,
      userId: freeUser._id,
      unreadCount: 2,
    });
    await Message.create({
      conversationId: activeConversation._id,
      senderId: paidUser._id,
      type: 'text',
      status: 'active',
      body: 'Mensaje de prueba',
    });
    await Message.create({
      conversationId: activeConversation._id,
      type: 'system',
      source: 'system',
      status: 'active',
      body: 'Mensaje de sistema',
    });

    const res = await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(token))
      .expect(200);

    expect(res.body).toHaveProperty('generatedAt');
    expect(res.body).toHaveProperty('systemHealth.overall');
    expect(res.body.pendingActions).toMatchObject({
      dunningCases: 1,
      cancellationsScheduled: 1,
      failedPayments: 1,
    });
    expect(res.body.users.totalUsers).toBeGreaterThanOrEqual(3);
    expect(res.body.memberships).toMatchObject({ activeMemberships: 2, inDunning: 1 });
    expect(res.body.catalog.activeListings).toBe(1);
    expect(res.body.payments).toMatchObject({ checkoutSessions: 1, successfulPayments: 1, failedPayments: 1 });
    expect(res.body.dunning).toMatchObject({ activeDunningCases: 1 });
    expect(res.body.auctions).toMatchObject({ live: 1, cancelled: 0 });
    expect(res.body.fiscal).toHaveProperty('transactions');
    expect(res.body.messaging).toMatchObject({
      conversationsTotal: 3,
      messagesTotal: 2,
      activeConversations: 1,
      archivedConversations: 1,
      closedConversations: 1,
      averageMessagesPerConversation: 2 / 3,
      conversationsWithUnreadMessages: 1,
    });
    expect(await Audit.exists({ action: adminControlCenterAuditActions.dashboardViewed })).toBeTruthy();
  });

  it('combines activity from audit, notifications, membership changes and webhooks without leaking payloads', async () => {
    const { token } = await adminContext();
    const user = await createTestUser();
    const plan = await createPlan('free');
    const membership = await createMembership(user, plan, 'active');
    const audit = await Audit.create({ actor: String(user._id), action: 'TEST_CONTROL_EVENT' });
    const notification = await Notification.create({
      userId: user._id,
      type: 'membership_recovered',
      title: 'Cuenta recuperada',
      message: 'Mensaje interno sin secretos',
    });
    const change = await MembershipChangeLog.create({
      userId: user._id,
      userMembershipId: membership._id,
      fromPlanId: plan._id,
      toPlanId: plan._id,
      changeType: 'reactivation_completed',
      source: 'admin',
      metadata: { token: 'sk_live_should_not_appear' },
    });
    const webhook = await PaymentWebhookLog.create({
      provider: 'stripe',
      providerEventId: 'evt_sensitive_identifier',
      eventType: 'invoice.paid',
      payloadHash: 'hash_sensitive',
      processed: true,
      attempts: 1,
      lastError: 'password=secret',
    });
    await setCreatedAt(Audit, audit._id, '2026-01-01T00:00:00.000Z');
    await setCreatedAt(Notification, notification._id, '2026-01-02T00:00:00.000Z');
    await setCreatedAt(MembershipChangeLog, change._id, '2026-01-03T00:00:00.000Z');
    await setCreatedAt(PaymentWebhookLog, webhook._id, '2026-01-04T00:00:00.000Z');

    const res = await request(app)
      .get('/admin/control-center/activity?limit=10')
      .set('Authorization', bearer(token))
      .expect(200);

    expect(res.body.activity.map((item: any) => item.type)).toEqual(
      expect.arrayContaining(['audit', 'notification', 'membership_change', 'payment_webhook'])
    );
    const dates = res.body.activity.map((item: any) => new Date(item.createdAt).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('sk_live_should_not_appear');
    expect(serialized).not.toContain('password=secret');
    expect(serialized).not.toContain('hash_sensitive');
    expect(serialized).not.toContain('evt_sensitive_identifier');
    expect(await Audit.exists({ action: adminControlCenterAuditActions.activityViewed })).toBeTruthy();
  });

  it('maps existing operational alert audits to severities and deduplicates alert codes', async () => {
    const { user, token } = await adminContext();
    await Audit.create({ actor: String(user._id), action: 'MEMBERSHIP_HIGH_DUNNING_RATE' });
    await Audit.create({ actor: String(user._id), action: 'MEMBERSHIP_HIGH_DUNNING_RATE' });
    await Audit.create({ actor: String(user._id), action: 'MEMBERSHIP_HIGH_PAYMENT_FAILURE_RATE' });
    await Audit.create({ actor: String(user._id), action: 'MEMBERSHIP_HIGH_CANCELLATION_RATE' });

    const res = await request(app)
      .get('/admin/control-center/alerts')
      .set('Authorization', bearer(token))
      .expect(200);

    const byCode = Object.fromEntries(res.body.alerts.map((alert: any) => [alert.code, alert]));
    expect(res.body.alerts.filter((alert: any) => alert.code === 'MEMBERSHIP_HIGH_DUNNING_RATE')).toHaveLength(1);
    expect(byCode.MEMBERSHIP_HIGH_DUNNING_RATE.severity).toBe(
      adminControlCenterAlertActions.MEMBERSHIP_HIGH_DUNNING_RATE.severity
    );
    expect(byCode.MEMBERSHIP_HIGH_PAYMENT_FAILURE_RATE.severity).toBe('critical');
    expect(byCode.MEMBERSHIP_HIGH_CANCELLATION_RATE.severity).toBe('medium');
    expect(await Audit.exists({ action: adminControlCenterAuditActions.alertsViewed })).toBeTruthy();
  });

  it('keeps existing admin and account surfaces available as a regression smoke test', async () => {
    const { token } = await adminContext();
    const user = await createTestUser();

    await request(app)
      .get('/admin/membership/dashboard')
      .set('Authorization', bearer(token))
      .expect(200);

    await request(app)
      .get('/account/membership')
      .set('Authorization', bearer(tokenFor(user)))
      .expect(200);
  });
});
