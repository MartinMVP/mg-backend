import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Audit } from '../../domain/audit/audit.model';
import { AuctionListing } from '../../domain/auctionListings/auctionListing.model';
import { PlatformConfiguration } from '../../domain/platformConfiguration/platformConfiguration.model';
import {
  platformConfigurationAuditActions,
  seedSandboxDefaultConfigurations,
  setConfig,
} from '../../domain/platformConfiguration/platformConfiguration.service';
import { MembershipPlan, MembershipBenefits } from '../../domain/memberships/membershipPlan.model';
import { MembershipUsage } from '../../domain/memberships/membershipUsage.model';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createTestListing, createTestUser } from '../../test/helpers/factories';

let app: typeof import('../../app').default;

const benefits: MembershipBenefits = {
  maxActiveListings: 5,
  maxPhotosPerListing: 10,
  canUseFeaturedListings: true,
  includedFeaturedListings: 5,
  canAccessAuctions: true,
  canAccessMetrics: true,
  supportLevel: 'priority',
};

async function createPlan(code: 'free' | 'pro' | 'business') {
  return MembershipPlan.findOneAndUpdate(
    { code },
    {
      $setOnInsert: {
        name: `PCC ${code}`,
        code,
        price: code === 'business' ? 999 : code === 'pro' ? 499 : 0,
        currency: 'MXN',
        billingPeriod: 'manual',
        benefits,
        isActive: true,
        isPublic: true,
        sortOrder: 1,
      },
    },
    { upsert: true, new: true, runValidators: true }
  );
}

async function assignPlan(userId: Types.ObjectId, code: 'free' | 'pro' | 'business') {
  const plan = await createPlan(code);
  const now = new Date();
  const membership = await UserMembership.create({
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
  await MembershipUsage.create({
    userId,
    membershipId: membership._id,
    planId: plan._id,
    activeListingsCount: 1,
    listingsCreatedThisPeriod: 1,
    featuredListingsUsed: 0,
    periodStart: membership.currentPeriodStart,
    periodEnd: membership.currentPeriodEnd,
  });
}

async function createBusinessAuctionListing() {
  const seller = await createTestUser('user');
  await assignPlan(seller._id, 'business');
  const listing = await createTestListing(seller._id);
  const token = createAccessToken(seller._id, 'user');
  const created = await request(app)
    .post('/auction-listings')
    .set('Authorization', bearer(token))
    .send({ listingId: String(listing._id), startingPrice: 50_000 })
    .expect(201);

  return { seller, listing, token, auctionListing: created.body };
}

async function createConversationPair(planCode: 'free' | 'pro' | 'business') {
  const buyer = await createTestUser('user');
  await assignPlan(buyer._id, planCode);
  const firstSeller = await createTestUser('user');
  const secondSeller = await createTestUser('user');
  return {
    buyer,
    token: createAccessToken(buyer._id, 'user'),
    firstListing: await createTestListing(firstSeller._id),
    secondListing: await createTestListing(secondSeller._id),
  };
}

describe('platform configuration center routes', () => {
  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  it('creates version 1, version 2, deactivates previous version, keeps history, and stores isProtected', async () => {
    const superUser = await createTestUser('super');

    const v1 = await setConfig({
      key: 'messaging.free.dailyConversationLimit',
      environment: 'sandbox',
      valueType: 'number',
      value: 10,
      description: 'Initial value',
      isProtected: true,
      changedBy: superUser._id,
    });
    const v2 = await setConfig({
      key: 'messaging.free.dailyConversationLimit',
      environment: 'sandbox',
      valueType: 'number',
      value: 15,
      description: 'Updated value',
      changedBy: superUser._id,
    });

    expect(v1.version).toBe(1);
    expect(v1.isProtected).toBe(true);
    expect(v2.version).toBe(2);
    await expect(PlatformConfiguration.countDocuments({
      key: 'messaging.free.dailyConversationLimit',
      environment: 'sandbox',
      isActive: true,
    })).resolves.toBe(1);
    await expect(PlatformConfiguration.findById(v1._id).then((doc) => doc?.isActive)).resolves.toBe(false);
    await expect(PlatformConfiguration.countDocuments({
      key: 'messaging.free.dailyConversationLimit',
      environment: 'sandbox',
    })).resolves.toBe(2);
  });

  it('validates supported value types and blocks mismatches', async () => {
    const superUser = await createTestUser('super');

    await expect(setConfig({
      key: 'pcc.string',
      environment: 'sandbox',
      valueType: 'string',
      value: 'ok',
      changedBy: superUser._id,
    })).resolves.toMatchObject({ value: 'ok' });
    await expect(setConfig({
      key: 'pcc.number',
      environment: 'sandbox',
      valueType: 'number',
      value: 123,
      changedBy: superUser._id,
    })).resolves.toMatchObject({ value: 123 });
    await expect(setConfig({
      key: 'pcc.boolean',
      environment: 'sandbox',
      valueType: 'boolean',
      value: false,
      changedBy: superUser._id,
    })).resolves.toMatchObject({ value: false });
    await expect(setConfig({
      key: 'pcc.json',
      environment: 'sandbox',
      valueType: 'json',
      value: { enabled: true },
      changedBy: superUser._id,
    })).resolves.toMatchObject({ value: { enabled: true } });
    await expect(setConfig({
      key: 'pcc.mismatch',
      environment: 'sandbox',
      valueType: 'number',
      value: 'not-a-number',
      changedBy: superUser._id,
    })).rejects.toThrow('platform_configuration_value_type_mismatch');
  });

  it('supports sandbox and explicit production while sandbox defaults do not create production configs', async () => {
    const superUser = await createTestUser('super');
    await setConfig({
      key: 'explicit.production',
      environment: 'production',
      valueType: 'boolean',
      value: true,
      changedBy: superUser._id,
    });
    expect(await PlatformConfiguration.exists({ environment: 'production', key: 'explicit.production' }))
      .toBeTruthy();

    await PlatformConfiguration.deleteMany({});
    await seedSandboxDefaultConfigurations(superUser._id);
    await expect(PlatformConfiguration.countDocuments({ environment: 'sandbox' })).resolves.toBe(26);
    await expect(PlatformConfiguration.countDocuments({ environment: 'production' })).resolves.toBe(0);
  });

  it('enforces admin read access, super write access, and blocks user or unauthenticated access', async () => {
    const admin = await createTestUser('admin');
    const superUser = await createTestUser('super');
    const user = await createTestUser('user');
    const superToken = createAccessToken(superUser._id, 'super');

    await request(app)
      .post('/admin/configurations')
      .set('Authorization', bearer(superToken))
      .send({
        environment: 'sandbox',
        key: 'route.security',
        valueType: 'number',
        value: 1,
      })
      .expect(201);

    await request(app)
      .get('/admin/configurations?environment=sandbox')
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .expect(200);
    await request(app)
      .get('/admin/configurations/route.security?environment=sandbox')
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .expect(200);
    await request(app)
      .get('/admin/configurations/route.security/history?environment=sandbox')
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .expect(200);
    await request(app)
      .post('/admin/configurations')
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .send({ environment: 'sandbox', key: 'route.security', valueType: 'number', value: 2 })
      .expect(403);
    await request(app)
      .get('/admin/configurations')
      .set('Authorization', bearer(createAccessToken(user._id, 'user')))
      .expect(403);
    await request(app).get('/admin/configurations').expect(401);
  });

  it('audits created, updated, and activated events', async () => {
    const superUser = await createTestUser('super');
    await setConfig({
      key: 'audit.config',
      environment: 'sandbox',
      valueType: 'number',
      value: 1,
      changedBy: superUser._id,
    });
    await setConfig({
      key: 'audit.config',
      environment: 'sandbox',
      valueType: 'number',
      value: 2,
      changedBy: superUser._id,
    });

    await expect(Audit.exists({ action: platformConfigurationAuditActions.created })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: platformConfigurationAuditActions.updated })).resolves.toBeTruthy();
    await expect(Audit.countDocuments({ action: platformConfigurationAuditActions.activated })).resolves.toBe(2);
  });

  it.each([
    ['free', 'messaging.free.dailyConversationLimit'],
    ['pro', 'messaging.pro.dailyConversationLimit'],
    ['business', 'messaging.business.dailyConversationLimit'],
  ] as const)('uses PCC daily conversation limit for %s memberships', async (planCode, key) => {
    const superUser = await createTestUser('super');
    await setConfig({ key, environment: 'sandbox', valueType: 'number', value: 1, changedBy: superUser._id });
    const context = await createConversationPair(planCode);

    await request(app)
      .post('/messaging/conversations')
      .set('Authorization', bearer(context.token))
      .send({ listingId: String(context.firstListing._id) })
      .expect(201);
    const blocked = await request(app)
      .post('/messaging/conversations')
      .set('Authorization', bearer(context.token))
      .send({ listingId: String(context.secondListing._id) })
      .expect(429);
    expect(blocked.body).toMatchObject({ error: 'conversation_daily_limit_reached', limit: 1, plan: planCode });
  });

  it('keeps safe messaging fallback when PCC config is absent', async () => {
    const context = await createConversationPair('free');

    await request(app)
      .post('/messaging/conversations')
      .set('Authorization', bearer(context.token))
      .send({ listingId: String(context.firstListing._id) })
      .expect(201);
    await request(app)
      .post('/messaging/conversations')
      .set('Authorization', bearer(context.token))
      .send({ listingId: String(context.secondListing._id) })
      .expect(201);
  });

  it('uses PCC duration, anti-sniping, max extensions, and increments for Auction Listings', async () => {
    const superUser = await createTestUser('super');
    await Promise.all([
      setConfig({ key: 'auction.minDurationDays', environment: 'sandbox', valueType: 'number', value: 2, changedBy: superUser._id }),
      setConfig({ key: 'auction.maxDurationDays', environment: 'sandbox', valueType: 'number', value: 4, changedBy: superUser._id }),
      setConfig({ key: 'auction.defaultDurationDays', environment: 'sandbox', valueType: 'number', value: 3, changedBy: superUser._id }),
      setConfig({ key: 'auction.snipingExtensionMinutes', environment: 'sandbox', valueType: 'number', value: 1, changedBy: superUser._id }),
      setConfig({ key: 'auction.maxExtensions', environment: 'sandbox', valueType: 'number', value: 1, changedBy: superUser._id }),
      setConfig({ key: 'auction.incrementTier1', environment: 'sandbox', valueType: 'number', value: 777, changedBy: superUser._id }),
    ]);
    const { auctionListing } = await createBusinessAuctionListing();
    const created = await AuctionListing.findById(auctionListing._id).lean();
    const durationDays = Math.round(
      ((created?.endsAt.getTime() || 0) - (created?.startsAt.getTime() || 0)) / (24 * 60 * 60_000)
    );
    expect(durationDays).toBe(3);

    const bidder = await createTestUser('user');
    const token = createAccessToken(bidder._id, 'user');
    await AuctionListing.updateOne(
      { _id: auctionListing._id },
      { $set: { endsAt: new Date(Date.now() + 30_000) } }
    );
    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(token))
      .send({ amount: 50_000 })
      .expect(201);
    const extended = await AuctionListing.findById(auctionListing._id).lean();
    expect(extended?.extensionCount).toBe(1);

    await AuctionListing.updateOne(
      { _id: auctionListing._id },
      { $set: { endsAt: new Date(Date.now() + 30_000) } }
    );
    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(token))
      .send({ amount: 50_776 })
      .expect(400);
    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(token))
      .send({ amount: 50_777 })
      .expect(201);
    const afterSecondBid = await AuctionListing.findById(auctionListing._id).lean();
    expect(afterSecondBid?.extensionCount).toBe(1);
  });

  it('keeps safe Auction Listings fallback when PCC config is absent', async () => {
    const { auctionListing } = await createBusinessAuctionListing();
    const created = await AuctionListing.findById(auctionListing._id).lean();
    const durationDays = Math.round(
      ((created?.endsAt.getTime() || 0) - (created?.startsAt.getTime() || 0)) / (24 * 60 * 60_000)
    );
    expect(durationDays).toBe(7);

    const bidder = await createTestUser('user');
    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(createAccessToken(bidder._id, 'user')))
      .send({ amount: 50_000 })
      .expect(201);
    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(createAccessToken(bidder._id, 'user')))
      .send({ amount: 50_499 })
      .expect(400);
    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(createAccessToken(bidder._id, 'user')))
      .send({ amount: 50_500 })
      .expect(201);
  });

  it('adds Admin Control Center configuration metrics and keeps core regressions working', async () => {
    const superUser = await createTestUser('super');
    const admin = await createTestUser('admin');
    await seedSandboxDefaultConfigurations(superUser._id);

    const dashboard = await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .expect(200);
    expect(dashboard.body.configurationCenter).toMatchObject({
      totalConfigs: 26,
      activeConfigs: 26,
      sandboxConfigs: 26,
      productionConfigs: 0,
    });
    expect(JSON.stringify(dashboard.body.configurationCenter)).not.toContain('dailyConversationLimit');

    const buyerContext = await createConversationPair('free');
    await request(app)
      .post('/messaging/conversations')
      .set('Authorization', bearer(buyerContext.token))
      .send({ listingId: String(buyerContext.firstListing._id) })
      .expect(201);
    await createBusinessAuctionListing();

    const member = await createTestUser('user');
    await assignPlan(member._id, 'pro');
    await request(app)
      .get('/account/membership')
      .set('Authorization', bearer(createAccessToken(member._id, 'user')))
      .expect(200);
  });
});

