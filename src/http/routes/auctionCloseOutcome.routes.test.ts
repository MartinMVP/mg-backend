import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Audit } from '../../domain/audit/audit.model';
import { AuctionListing } from '../../domain/auctionListings/auctionListing.model';
import { closeAuctionListing } from '../../domain/auctionListings/auctionListing.service';
import { AuctionCloseOutcome } from '../../domain/auctionOperations/auctionCloseOutcome.model';
import { auctionCloseOutcomeAuditActions } from '../../domain/auctionOperations/auctionCloseOutcome.service';
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

async function createPlan(code: 'business') {
  return MembershipPlan.findOneAndUpdate(
    { code },
    {
      $setOnInsert: {
        name: `Auction outcome ${code}`,
        code,
        price: 999,
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

async function assignBusinessPlan(userId: Types.ObjectId) {
  const plan = await createPlan('business');
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

async function createClosedAuctionListingWithWinner() {
  const seller = await createTestUser('user');
  const winner = await createTestUser('user');
  await assignBusinessPlan(seller._id);
  const listing = await createTestListing(seller._id);

  const created = await request(app)
    .post('/auction-listings')
    .set('Authorization', bearer(createAccessToken(seller._id, 'user')))
    .send({ listingId: String(listing._id), startingPrice: 50_000 })
    .expect(201);

  await request(app)
    .post(`/auction-listings/${created.body._id}/bids`)
    .set('Authorization', bearer(createAccessToken(winner._id, 'user')))
    .send({ amount: 50_000 })
    .expect(201);

  await AuctionListing.updateOne(
    { _id: created.body._id },
    { $set: { endsAt: new Date(Date.now() - 60_000) } }
  );
  await closeAuctionListing(created.body._id);

  return {
    seller,
    winner,
    listing,
    auctionListing: await AuctionListing.findById(created.body._id).lean(),
  };
}

describe('auction close outcome routes', () => {
  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  it('records one seller completed outcome, sends auction system message, and audits it', async () => {
    const { seller, auctionListing } = await createClosedAuctionListingWithWinner();

    const res = await request(app)
      .post(`/auction-listings/${auctionListing?._id}/close-outcome`)
      .set('Authorization', bearer(createAccessToken(seller._id, 'user')))
      .send({ outcome: 'completed' })
      .expect(201);

    expect(res.body).toMatchObject({ outcome: 'completed' });
    await expect(AuctionCloseOutcome.countDocuments({ auctionListingId: auctionListing?._id })).resolves.toBe(1);
    await expect(Message.exists({
      type: 'system',
      source: 'auction',
      eventKey: `auction-close-outcome:${auctionListing?._id}`,
    })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: auctionCloseOutcomeAuditActions.recorded })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: auctionCloseOutcomeAuditActions.completedConfirmed })).resolves.toBeTruthy();
  });

  it('rejects duplicate outcomes for the same auction listing', async () => {
    const { seller, auctionListing } = await createClosedAuctionListingWithWinner();
    const token = createAccessToken(seller._id, 'user');

    await request(app)
      .post(`/auction-listings/${auctionListing?._id}/close-outcome`)
      .set('Authorization', bearer(token))
      .send({ outcome: 'not_completed' })
      .expect(201);

    await request(app)
      .post(`/auction-listings/${auctionListing?._id}/close-outcome`)
      .set('Authorization', bearer(token))
      .send({ outcome: 'completed' })
      .expect(409);
  });

  it('keeps auction close outcomes immutable after creation', async () => {
    const { seller, auctionListing } = await createClosedAuctionListingWithWinner();
    const created = await request(app)
      .post(`/auction-listings/${auctionListing?._id}/close-outcome`)
      .set('Authorization', bearer(createAccessToken(seller._id, 'user')))
      .send({ outcome: 'completed' })
      .expect(201);

    await expect(AuctionCloseOutcome.updateOne(
      { _id: created.body._id },
      { $set: { outcome: 'not_completed' } }
    )).rejects.toThrow('auction_close_outcome_immutable');

    await expect(AuctionCloseOutcome.findById(created.body._id).then((doc) => doc?.outcome)).resolves.toBe('completed');
  });

  it('validates supported outcomes and blocks seller_unresponsive on close-outcome endpoint', async () => {
    const { seller, auctionListing } = await createClosedAuctionListingWithWinner();
    const token = createAccessToken(seller._id, 'user');

    await request(app)
      .post(`/auction-listings/${auctionListing?._id}/close-outcome`)
      .set('Authorization', bearer(token))
      .send({ outcome: 'refunded' })
      .expect(400);

    await request(app)
      .post(`/auction-listings/${auctionListing?._id}/close-outcome`)
      .set('Authorization', bearer(token))
      .send({ outcome: 'seller_unresponsive' })
      .expect(400);
  });

  it('enforces seller and winner permissions', async () => {
    const { seller, winner, auctionListing } = await createClosedAuctionListingWithWinner();
    const other = await createTestUser('user');

    await request(app)
      .post(`/auction-listings/${auctionListing?._id}/close-outcome`)
      .set('Authorization', bearer(createAccessToken(other._id, 'user')))
      .send({ outcome: 'completed' })
      .expect(403);

    await request(app)
      .post(`/auction-listings/${auctionListing?._id}/report-seller-unresponsive`)
      .set('Authorization', bearer(createAccessToken(seller._id, 'user')))
      .expect(403);

    await request(app)
      .post(`/auction-listings/${auctionListing?._id}/report-seller-unresponsive`)
      .set('Authorization', bearer(createAccessToken(winner._id, 'user')))
      .expect(201);
  });

  it('records seller unresponsive reports with messaging and audit events', async () => {
    const { winner, auctionListing } = await createClosedAuctionListingWithWinner();

    await request(app)
      .post(`/auction-listings/${auctionListing?._id}/report-seller-unresponsive`)
      .set('Authorization', bearer(createAccessToken(winner._id, 'user')))
      .expect(201);

    await expect(AuctionCloseOutcome.exists({
      auctionListingId: auctionListing?._id,
      outcome: 'seller_unresponsive',
    })).resolves.toBeTruthy();
    await expect(Message.exists({ source: 'auction', eventKey: `auction-close-outcome:${auctionListing?._id}` }))
      .resolves.toBeTruthy();
    await expect(Audit.exists({ action: auctionCloseOutcomeAuditActions.sellerUnresponsiveReported }))
      .resolves.toBeTruthy();
  });

  it('rejects seller unresponsive reports when the auction conversation is missing', async () => {
    const { winner, auctionListing } = await createClosedAuctionListingWithWinner();
    await Conversation.deleteMany({ auctionListingId: auctionListing?._id });

    await request(app)
      .post(`/auction-listings/${auctionListing?._id}/report-seller-unresponsive`)
      .set('Authorization', bearer(createAccessToken(winner._id, 'user')))
      .expect(409)
      .expect((res) => {
        expect(res.body.error).toBe('auction_conversation_required');
      });

    await expect(AuctionCloseOutcome.countDocuments({ auctionListingId: auctionListing?._id })).resolves.toBe(0);
    await expect(Message.exists({
      type: 'system',
      source: 'auction',
      eventKey: `auction-close-outcome:${auctionListing?._id}`,
    })).resolves.toBeFalsy();
    await expect(Audit.exists({ action: auctionCloseOutcomeAuditActions.sellerUnresponsiveReported }))
      .resolves.toBeFalsy();
  });

  it('allows admin and super to list and read close outcomes while blocking normal users', async () => {
    const { seller, auctionListing } = await createClosedAuctionListingWithWinner();
    const outcome = await request(app)
      .post(`/auction-listings/${auctionListing?._id}/close-outcome`)
      .set('Authorization', bearer(createAccessToken(seller._id, 'user')))
      .send({ outcome: 'not_completed' })
      .expect(201);

    const user = await createTestUser('user');
    await request(app)
      .get('/admin/auction-close-outcomes')
      .set('Authorization', bearer(createAccessToken(user._id, 'user')))
      .expect(403);

    const admin = await createTestUser('admin');
    const list = await request(app)
      .get('/admin/auction-close-outcomes?page=1&limit=1')
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .expect(200);
    expect(list.body).toMatchObject({ page: 1, limit: 1, total: 1 });
    expect(list.body.outcomes).toHaveLength(1);

    const superUser = await createTestUser('super');
    const detail = await request(app)
      .get(`/admin/auction-close-outcomes/${outcome.body._id}`)
      .set('Authorization', bearer(createAccessToken(superUser._id, 'super')))
      .expect(200);
    expect(detail.body.outcome).toBe('not_completed');
  });

  it('adds aggregate admin metrics and keeps Sprint 10.3 auction listing flow stable', async () => {
    const completed = await createClosedAuctionListingWithWinner();
    await request(app)
      .post(`/auction-listings/${completed.auctionListing?._id}/close-outcome`)
      .set('Authorization', bearer(createAccessToken(completed.seller._id, 'user')))
      .send({ outcome: 'completed' })
      .expect(201);

    const unresponsive = await createClosedAuctionListingWithWinner();
    await request(app)
      .post(`/auction-listings/${unresponsive.auctionListing?._id}/report-seller-unresponsive`)
      .set('Authorization', bearer(createAccessToken(unresponsive.winner._id, 'user')))
      .expect(201);

    const admin = await createTestUser('admin');
    const dashboard = await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .expect(200);

    expect(dashboard.body.auctionOperations).toMatchObject({
      completedOutcomes: 1,
      notCompletedOutcomes: 0,
      sellerUnresponsiveReports: 1,
    });
    expect(JSON.stringify(dashboard.body.auctionOperations)).not.toContain('conversationId');
    await expect(Conversation.countDocuments({ type: 'auction' })).resolves.toBe(2);
    await request(app).get('/auction-listings').expect(200);
    await request(app)
      .get(`/auction-listings/${completed.auctionListing?._id}/bids`)
      .expect(200);
  });
});
