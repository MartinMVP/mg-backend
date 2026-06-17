import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Audit } from '../../domain/audit/audit.model';
import { AuctionBid } from '../../domain/auctionListings/auctionBid.model';
import { AuctionListing } from '../../domain/auctionListings/auctionListing.model';
import {
  auctionListingAuditActions,
  closeAuctionListing,
} from '../../domain/auctionListings/auctionListing.service';
import { Listing } from '../../domain/listings/listing.model';
import { MembershipPlan, MembershipBenefits } from '../../domain/memberships/membershipPlan.model';
import { MembershipUsage } from '../../domain/memberships/membershipUsage.model';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { Conversation } from '../../domain/messaging/conversation.model';
import { Message } from '../../domain/messaging/message.model';
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
        name: `Auction ${code}`,
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
  const usage = await MembershipUsage.create({
    userId,
    membershipId: membership._id,
    planId: plan._id,
    activeListingsCount: 1,
    listingsCreatedThisPeriod: 1,
    featuredListingsUsed: 0,
    periodStart: membership.currentPeriodStart,
    periodEnd: membership.currentPeriodEnd,
  });
  return { plan, membership, usage };
}

async function businessAuctionContext() {
  const seller = await createTestUser('user');
  const { usage } = await assignPlan(seller._id, 'business');
  const listing = await createTestListing(seller._id);
  const token = createAccessToken(seller._id, 'user');
  return { seller, usage, listing, token };
}

async function createAuctionListingFixture(overrides: Record<string, unknown> = {}) {
  const context = await businessAuctionContext();
  const res = await request(app)
    .post('/auction-listings')
    .set('Authorization', bearer(context.token))
    .send({
      listingId: String(context.listing._id),
      startingPrice: 50_000,
      durationDays: 7,
      ...overrides,
    })
    .expect(201);
  return { ...context, auctionListing: res.body };
}

describe('auction listing routes', () => {
  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  it('blocks free and pro users while allowing business users to create auction listings', async () => {
    for (const code of ['free', 'pro'] as const) {
      const seller = await createTestUser('user');
      await assignPlan(seller._id, code);
      const listing = await createTestListing(seller._id);

      await request(app)
        .post('/auction-listings')
        .set('Authorization', bearer(createAccessToken(seller._id, 'user')))
        .send({ listingId: String(listing._id), startingPrice: 50_000 })
        .expect(403);
    }

    const { listing } = await createAuctionListingFixture();
    await expect(Listing.findById(listing._id).then((doc) => doc?.status)).resolves.toBe('auction_active');
  });

  it('derives seller from listing animal, rejects sellerId body, requires own eligible listing, and preserves capacity', async () => {
    const { seller, usage, listing, token } = await businessAuctionContext();
    const other = await createTestUser('user');
    const otherListing = await createTestListing(other._id);

    await request(app)
      .post('/auction-listings')
      .set('Authorization', bearer(token))
      .send({ listingId: String(listing._id), sellerId: String(other._id), startingPrice: 50_000 })
      .expect(400);

    await request(app)
      .post('/auction-listings')
      .set('Authorization', bearer(token))
      .send({ listingId: String(otherListing._id), startingPrice: 50_000 })
      .expect(403);

    await Listing.updateOne({ _id: listing._id }, { $set: { status: 'archived' } });
    await request(app)
      .post('/auction-listings')
      .set('Authorization', bearer(token))
      .send({ listingId: String(listing._id), startingPrice: 50_000 })
      .expect(409);

    await Listing.updateOne({ _id: listing._id }, { $set: { status: 'published' } });
    const created = await request(app)
      .post('/auction-listings')
      .set('Authorization', bearer(token))
      .send({ listingId: String(listing._id), startingPrice: 50_000 })
      .expect(201);

    expect(String(created.body.sellerId)).toBe(String(seller._id));
    const updatedUsage = await MembershipUsage.findById(usage._id).lean();
    expect(updatedUsage?.activeListingsCount).toBe(1);
    expect(updatedUsage?.listingsCreatedThisPeriod).toBe(1);
    await expect(Audit.exists({ action: auctionListingAuditActions.created })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: auctionListingAuditActions.published })).resolves.toBeTruthy();
  });

  it('accepts valid bids, rejects invalid increments and seller bids, and blocks closed or out-of-window bids', async () => {
    const { seller, auctionListing } = await createAuctionListingFixture();
    const bidder = await createTestUser('user');
    const bidderToken = createAccessToken(bidder._id, 'user');

    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(createAccessToken(seller._id, 'user')))
      .send({ amount: 50_000 })
      .expect(400);

    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(bidderToken))
      .send({ amount: 49_999 })
      .expect(400);

    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(bidderToken))
      .send({ amount: 50_000 })
      .expect(201);

    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(bidderToken))
      .send({ amount: 50_499 })
      .expect(400);

    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(bidderToken))
      .send({ amount: 51_000 })
      .expect(201);

    await AuctionListing.updateOne(
      { _id: auctionListing._id },
      { $set: { startsAt: new Date(Date.now() + 60_000) } }
    );
    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(bidderToken))
      .send({ amount: 52_000 })
      .expect(400);

    await AuctionListing.updateOne(
      { _id: auctionListing._id },
      { $set: { status: 'closed', startsAt: new Date(Date.now() - 60_000) } }
    );
    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(bidderToken))
      .send({ amount: 52_000 })
      .expect(400);

    await expect(AuctionBid.countDocuments({ status: 'valid' })).resolves.toBe(2);
    await expect(Audit.exists({ action: auctionListingAuditActions.bidPlaced })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: auctionListingAuditActions.bidRejected })).resolves.toBeTruthy();
  });

  it('applies anti-sniping extensions up to three times', async () => {
    const { auctionListing } = await createAuctionListingFixture();
    const bidder = await createTestUser('user');
    const token = createAccessToken(bidder._id, 'user');
    for (const amount of [50_000, 51_000, 52_000, 53_000]) {
      await AuctionListing.updateOne(
        { _id: auctionListing._id },
        { $set: { endsAt: new Date(Date.now() + 4 * 60_000) } }
      );
      await request(app)
        .post(`/auction-listings/${auctionListing._id}/bids`)
        .set('Authorization', bearer(token))
        .send({ amount })
        .expect(201);
    }

    const updated = await AuctionListing.findById(auctionListing._id).lean();
    expect(updated?.extensionCount).toBe(3);
    await expect(Audit.countDocuments({ action: auctionListingAuditActions.extended })).resolves.toBe(3);
  });

  it('closes expired auctions without bids back to published and allows manual admin close', async () => {
    const { auctionListing, listing } = await createAuctionListingFixture();
    await AuctionListing.updateOne(
      { _id: auctionListing._id },
      { $set: { endsAt: new Date(Date.now() - 60_000) } }
    );

    const closed = await closeAuctionListing(auctionListing._id);
    expect(closed?.status).toBe('closed');
    await expect(Listing.findById(listing._id).then((doc) => doc?.status)).resolves.toBe('published');

    const second = await createAuctionListingFixture();
    const admin = await createTestUser('admin');
    await request(app)
      .post(`/admin/auction-listings/${second.auctionListing._id}/close`)
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .expect(200);
  });

  it('selects winner, moves listing to auction_closed, creates messaging conversation, and audits winner flow', async () => {
    const { auctionListing, listing } = await createAuctionListingFixture();
    const firstBidder = await createTestUser('user');
    const winner = await createTestUser('user');

    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(createAccessToken(firstBidder._id, 'user')))
      .send({ amount: 50_000 })
      .expect(201);
    const winningBid = await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(createAccessToken(winner._id, 'user')))
      .send({ amount: 51_000 })
      .expect(201);

    await AuctionListing.updateOne(
      { _id: auctionListing._id },
      { $set: { endsAt: new Date(Date.now() - 60_000) } }
    );
    const closed = await closeAuctionListing(auctionListing._id);

    expect(String(closed?.winnerUserId)).toBe(String(winner._id));
    expect(String(closed?.winningBidId)).toBe(String(winningBid.body.bid._id));
    await expect(Listing.findById(listing._id).then((doc) => doc?.status)).resolves.toBe('auction_closed');
    await expect(Conversation.exists({ type: 'auction', auctionListingId: auctionListing._id })).resolves.toBeTruthy();
    await expect(Message.exists({ type: 'system', source: 'auction' })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: auctionListingAuditActions.winnerSelected })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: auctionListingAuditActions.winnerConversationCreated })).resolves.toBeTruthy();
  });

  it('paginates auction listings and bid history', async () => {
    const { auctionListing } = await createAuctionListingFixture();
    const bidder = await createTestUser('user');
    const token = createAccessToken(bidder._id, 'user');

    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(token))
      .send({ amount: 50_000 })
      .expect(201);
    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(token))
      .send({ amount: 51_000 })
      .expect(201);

    const listings = await request(app).get('/auction-listings?page=1&limit=1').expect(200);
    expect(listings.body).toMatchObject({ page: 1, limit: 1, total: 1 });
    expect(listings.body.auctionListings).toHaveLength(1);

    const bids = await request(app).get(`/auction-listings/${auctionListing._id}/bids?page=1&limit=1`).expect(200);
    expect(bids.body).toMatchObject({ page: 1, limit: 1, total: 2 });
    expect(bids.body.bids).toHaveLength(1);
  });

  it('adds aggregate admin metrics and keeps messaging, membership, catalog, revenue and fiscal surfaces stable', async () => {
    const { auctionListing } = await createAuctionListingFixture();
    const bidder = await createTestUser('user');
    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(createAccessToken(bidder._id, 'user')))
      .send({ amount: 50_000 })
      .expect(201);

    const admin = await createTestUser('admin');
    const adminToken = createAccessToken(admin._id, 'admin');
    const dashboard = await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(adminToken))
      .expect(200);
    expect(dashboard.body.auctionListings).toMatchObject({
      total: 1,
      active: 1,
      closed: 0,
      cancelled: 0,
      bidsTotal: 1,
    });
    expect(JSON.stringify(dashboard.body.auctionListings)).not.toContain('bidderId');

    await request(app).get('/auction-listings').expect(200);
    await request(app).get('/catalog/listings').expect(200);
    await request(app)
      .get('/account/membership')
      .set('Authorization', bearer(createAccessToken(bidder._id, 'user')))
      .expect(200);
    await request(app)
      .get('/admin/payments/records')
      .set('Authorization', bearer(adminToken))
      .expect(200);
    await request(app)
      .get('/admin/fiscal/transactions')
      .set('Authorization', bearer(adminToken))
      .expect(200);
  });
});
