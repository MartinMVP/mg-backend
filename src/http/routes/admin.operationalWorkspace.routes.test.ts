import request from 'supertest';
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { FiscalOperation } from '../../domain/fiscalOperations/fiscalOperation.model';
import { Listing } from '../../domain/listings/listing.model';
import { MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { Conversation } from '../../domain/messaging/conversation.model';
import { CommercialOperation } from '../../domain/payments/commercialOperation.model';
import { PaymentTransaction } from '../../domain/payments/paymentTransaction.model';
import { User } from '../../domain/users/user.model';
import { bearer } from '../../test/helpers/auth';
import { createTestListing, createTestUser } from '../../test/helpers/factories';
import { signAccessToken } from '../../utils/jwt';

function tokenFor(user: any, role = user.role) {
  return signAccessToken({ sub: String(user._id), role, typ: 'access' });
}

async function createPlan() {
  const suffix = new Types.ObjectId().toString().slice(-8);
  return MembershipPlan.create({
    name: `Workspace ${suffix}`,
    code: `workspace-${suffix}`,
    price: 499,
    monthlyPrice: 499,
    yearlyPrice: 4990,
    durationDays: 30,
    currency: 'MXN',
    billingPeriod: 'manual',
    benefits: {
      maxActiveListings: 10,
      maxPhotosPerListing: 8,
      canUseFeaturedListings: true,
      includedFeaturedListings: 2,
      canAccessAuctions: true,
      canAccessMetrics: true,
      supportLevel: 'priority',
    },
    limits: { messaging: 100 },
    isActive: true,
    isPublic: true,
    sortOrder: 1,
  });
}

async function createMembership(userId: Types.ObjectId, status = 'pending_activation') {
  const plan = await createPlan();
  const now = new Date();
  return UserMembership.create({
    userId,
    planId: plan._id,
    status,
    startsAt: now,
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
    source: 'admin',
    renewalMode: 'manual',
    paymentProvider: 'none',
  });
}

async function createPayment(status: 'failed' | 'settled' = 'failed') {
  const operation = await CommercialOperation.create({
    operationNumber: `EG-2026-${new Types.ObjectId().toString().slice(-9)}`,
    operationType: 'membership',
    referenceType: 'membership',
    referenceId: new Types.ObjectId().toString(),
    amount: 499,
    currency: 'MXN',
    status: status === 'settled' ? 'paid' : 'failed',
  });
  await PaymentTransaction.create({
    operationId: operation._id,
    operationNumber: operation.operationNumber,
    provider: 'internal',
    providerPaymentIntentId: `pi_${new Types.ObjectId().toString()}`,
    amount: operation.amount,
    currency: operation.currency,
    status,
  });
  return operation;
}

async function createFailedFiscalOperation() {
  const operation = await createPayment('settled');
  return FiscalOperation.create({
    operationId: new Types.ObjectId(),
    commercialOperationId: operation._id,
    invoiceStatus: 'failed',
    provider: 'mock',
    amount: 499,
    currency: 'MXN',
    transientError: true,
    lastError: 'temporary provider failure',
  });
}

describe('Operational Workspace 13.7', () => {
  it('requires admin or super role for operational dashboard', async () => {
    const admin = await createTestUser('admin');
    const user = await createTestUser('user');

    await request(app)
      .get('/admin/dashboard')
      .set('Authorization', bearer(tokenFor(user)))
      .expect(403);

    const res = await request(app)
      .get('/admin/dashboard')
      .set('Authorization', bearer(tokenFor(admin)))
      .expect(200);

    expect(res.body.kpis).toHaveProperty('users');
    expect(res.body.workspaces).toHaveProperty('marketplace');
    expect(res.body.workspaces).toHaveProperty('membership');
    expect(res.body.workspaces).toHaveProperty('revenue');
    expect(res.body.workspaces).toHaveProperty('fiscal');
    expect(res.body.workspaces).toHaveProperty('messaging');
  });

  it('exposes operational queue and needs-attention workspaces', async () => {
    const admin = await createTestUser('admin');
    const buyer = await createTestUser('user');
    const seller = await createTestUser('user');
    await createMembership(buyer._id);
    await createPayment('failed');
    await createFailedFiscalOperation();
    await Conversation.create({
      type: 'commercial',
      status: 'active',
      sellerId: seller._id,
      buyerId: buyer._id,
      createdBy: buyer._id,
      messageCount: 1,
    });

    const token = tokenFor(admin);
    const queue = await request(app)
      .get('/admin/operations/queue')
      .set('Authorization', bearer(token))
      .expect(200);
    const attention = await request(app)
      .get('/admin/operations/needs-attention')
      .set('Authorization', bearer(token))
      .expect(200);

    expect(queue.body.items.map((item: any) => item.type)).toContain('payment_failed');
    expect(queue.body.items.map((item: any) => item.type)).toContain('fiscal_failed');
    expect(queue.body.items.map((item: any) => item.type)).toContain('membership_pending_activation');
    expect(attention.body.total).toBeGreaterThan(0);
  });

  it('lists operational workspaces without direct database access', async () => {
    const admin = await createTestUser('admin');
    const user = await createTestUser('user');
    const listing = await createTestListing(user._id);
    const membership = await createMembership(user._id, 'active');
    await createFailedFiscalOperation();
    await Conversation.create({
      type: 'commercial',
      status: 'active',
      sellerId: user._id,
      buyerId: admin._id,
      createdBy: admin._id,
    });

    const token = bearer(tokenFor(admin));
    await request(app).get('/admin/users').set('Authorization', token).expect(200);
    await request(app).get('/admin/memberships').set('Authorization', token).expect(200);
    await request(app).get('/admin/listings').set('Authorization', token).expect(200);
    await request(app).get('/admin/conversations').set('Authorization', token).expect(200);
    await request(app).get('/admin/payments').set('Authorization', token).expect(200);
    await request(app)
      .get('/admin/fiscal')
      .set('Authorization', token)
      .expect(200)
      .expect((res) => {
        expect(res.body.items.length).toBeGreaterThan(0);
      });

    expect(listing._id).toBeTruthy();
    expect(membership._id).toBeTruthy();
  });

  it('executes operational actions and writes audit evidence', async () => {
    const admin = await createTestUser('admin');
    const user = await createTestUser('user');
    const listing = await createTestListing(user._id);
    const membership = await createMembership(user._id);
    const conversation = await Conversation.create({
      type: 'commercial',
      status: 'active',
      sellerId: user._id,
      buyerId: admin._id,
      createdBy: admin._id,
    });
    const token = bearer(tokenFor(admin));

    await request(app).post(`/admin/users/${user._id}/suspend`).set('Authorization', token).expect(200);
    await request(app).post(`/admin/listings/${listing._id}/archive`).set('Authorization', token).expect(200);
    await request(app)
      .patch(`/admin/memberships/${membership._id}`)
      .set('Authorization', token)
      .send({ status: 'suspended' })
      .expect(200);
    await request(app).post(`/admin/conversations/${conversation._id}/close`).set('Authorization', token).expect(200);

    await expect(User.findById(user._id).lean()).resolves.toMatchObject({ status: 'suspended' });
    await expect(Listing.findById(listing._id).lean()).resolves.toMatchObject({ status: 'archived' });
    await expect(Conversation.findById(conversation._id).lean()).resolves.toMatchObject({ status: 'closed' });

    const actions = await Audit.find({ actor: String(admin._id) }).distinct('action');
    expect(actions).toEqual(expect.arrayContaining([
      'ADMIN_USER_SUSPENDED',
      'ADMIN_LISTING_ARCHIVED',
      'ADMIN_MEMBERSHIP_UPDATED',
      'ADMIN_CONVERSATION_CLOSED',
    ]));
  });

  it('reconciles payments and recovers fiscal operations with operational audit events', async () => {
    const admin = await createTestUser('admin');
    const token = bearer(tokenFor(admin));
    await createFailedFiscalOperation();

    await request(app)
      .post('/admin/payments/reconcile')
      .set('Authorization', token)
      .send({ provider: 'internal' })
      .expect(201);
    await request(app)
      .post('/admin/fiscal/recover')
      .set('Authorization', token)
      .expect(200)
      .expect((res) => {
        expect(res.body.candidates).toBeGreaterThan(0);
      });

    const actions = await Audit.find({ actor: String(admin._id) }).distinct('action');
    expect(actions).toContain('ADMIN_PAYMENT_RECONCILED');
    expect(actions).toContain('ADMIN_FISCAL_RECOVERED');
  });
});
