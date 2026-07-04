import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Audit } from '../../domain/audit/audit.model';
import { AuctionAppeal } from '../../domain/auctionAppeals/auctionAppeal.model';
import { auctionAppealAuditActions } from '../../domain/auctionAppeals/auctionAppeal.service';
import { AuctionDefaultReport } from '../../domain/auctionDefaults/auctionDefault.model';
import { auctionDefaultAuditActions } from '../../domain/auctionDefaults/auctionDefault.service';
import { AuctionListing } from '../../domain/auctionListings/auctionListing.model';
import { closeAuctionListing } from '../../domain/auctionListings/auctionListing.service';
import { AuctionSanction } from '../../domain/auctionSanctions/auctionSanction.model';
import {
  auctionSanctionAuditActions,
  buildAuctionSanctionRecommendation,
} from '../../domain/auctionSanctions/auctionSanction.service';
import { MembershipPlan, MembershipBenefits } from '../../domain/memberships/membershipPlan.model';
import { MembershipUsage } from '../../domain/memberships/membershipUsage.model';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { Conversation } from '../../domain/messaging/conversation.model';
import { Message } from '../../domain/messaging/message.model';
import { setConfig } from '../../domain/platformConfiguration/platformConfiguration.service';
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

async function assignBusinessPlan(userId: Types.ObjectId) {
  const plan = await MembershipPlan.findOneAndUpdate(
    { code: 'business' },
    {
      $setOnInsert: {
        name: 'Auction sanctions business',
        code: 'business',
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

async function createAuctionListingForSeller(sellerId: Types.ObjectId) {
  await assignBusinessPlan(sellerId);
  const listing = await createTestListing(sellerId);
  const created = await request(app)
    .post('/auction-listings')
    .set('Authorization', bearer(createAccessToken(sellerId, 'user')))
    .send({ listingId: String(listing._id), startingPrice: 50_000 })
    .expect(201);
  return { listing, auctionListing: created.body };
}

async function createClosedAuctionListingWithWinner() {
  const seller = await createTestUser('user');
  const winner = await createTestUser('user');
  const { listing, auctionListing } = await createAuctionListingForSeller(seller._id);

  await request(app)
    .post(`/auction-listings/${auctionListing._id}/bids`)
    .set('Authorization', bearer(createAccessToken(winner._id, 'user')))
    .send({ amount: 50_000 })
    .expect(201);

  await AuctionListing.updateOne(
    { _id: auctionListing._id },
    { $set: { endsAt: new Date(Date.now() - 60_000) } }
  );
  await closeAuctionListing(auctionListing._id);

  return {
    seller,
    winner,
    listing,
    auctionListing: await AuctionListing.findById(auctionListing._id).lean(),
    conversation: await Conversation.findOne({ auctionListingId: auctionListing._id, type: 'auction' }).lean(),
  };
}

async function createConfirmedDefault(role: 'buyer' | 'seller' = 'buyer') {
  const context = await createClosedAuctionListingWithWinner();
  const reporter = role === 'buyer' ? context.seller : context.winner;
  const reported = role === 'buyer' ? context.winner : context.seller;
  const category = role === 'buyer' ? 'buyer_refused' : 'seller_no_response';
  const admin = await createTestUser('admin');

  const report = await request(app)
    .post(`/auction-listings/${context.auctionListing?._id}/defaults`)
    .set('Authorization', bearer(createAccessToken(reporter._id, 'user')))
    .send({
      reportedUserId: String(reported._id),
      category,
      description: 'Default report with enough operational evidence.',
      evidence: { note: 'safe', token: 'must-not-store' },
    })
    .expect(201);

  const confirmed = await request(app)
    .post(`/admin/auction-defaults/${report.body._id}/confirm`)
    .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
    .send({})
    .expect(200);

  return { ...context, admin, reported, report: report.body, confirmation: confirmed.body };
}

async function applyConfirmedDefault(role: 'buyer' | 'seller' = 'buyer') {
  const context = await createConfirmedDefault(role);
  const sanction = await request(app)
    .post('/admin/auction-sanctions/apply')
    .set('Authorization', bearer(createAccessToken(context.admin._id, 'admin')))
    .send({ recommendation: context.confirmation.recommendation })
    .expect(201);
  return { ...context, sanction: sanction.body };
}

describe('auction defaults, sanctions and appeals routes', () => {
  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  it('creates one active default report per reported user and auction, sanitizes evidence, messages and audits', async () => {
    const { seller, winner, auctionListing, conversation } = await createClosedAuctionListingWithWinner();

    const res = await request(app)
      .post(`/auction-listings/${auctionListing?._id}/defaults`)
      .set('Authorization', bearer(createAccessToken(seller._id, 'user')))
      .send({
        reportedUserId: String(winner._id),
        category: 'buyer_no_response',
        description: 'Buyer stopped responding after winning the auction.',
        evidence: { note: 'safe evidence', token: 'redacted' },
      })
      .expect(201);

    expect(res.body).toMatchObject({ status: 'pending', role: 'buyer', category: 'buyer_no_response' });
    expect(JSON.stringify(res.body.evidence)).not.toContain('redacted');
    await request(app)
      .post(`/auction-listings/${auctionListing?._id}/defaults`)
      .set('Authorization', bearer(createAccessToken(seller._id, 'user')))
      .send({
        reportedUserId: String(winner._id),
        category: 'buyer_refused',
        description: 'Duplicate active report should be blocked.',
      })
      .expect(409);
    await expect(Message.exists({
      conversationId: conversation?._id,
      type: 'system',
      source: 'auction',
      eventKey: `auction-default-reported:${res.body._id}`,
    })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: auctionDefaultAuditActions.reported })).resolves.toBeTruthy();
  });

  it('allows admin confirmation and rejection while normal users cannot review defaults', async () => {
    const { seller, winner, auctionListing } = await createClosedAuctionListingWithWinner();
    const report = await request(app)
      .post(`/auction-listings/${auctionListing?._id}/defaults`)
      .set('Authorization', bearer(createAccessToken(winner._id, 'user')))
      .send({
        reportedUserId: String(seller._id),
        category: 'seller_no_response',
        description: 'Seller stopped responding after the auction closed.',
      })
      .expect(201);

    await request(app)
      .post(`/admin/auction-defaults/${report.body._id}/confirm`)
      .set('Authorization', bearer(createAccessToken(winner._id, 'user')))
      .send({})
      .expect(403);

    const admin = await createTestUser('admin');
    const confirmed = await request(app)
      .post(`/admin/auction-defaults/${report.body._id}/confirm`)
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .send({})
      .expect(200);
    expect(confirmed.body.default).toMatchObject({ status: 'confirmed', resolutionType: 'seller_default' });
    expect(confirmed.body.recommendation).toMatchObject({
      offenseNumber: 1,
      recommendedAction: 'temporary_suspension',
      recommendedDurationDays: 30,
      sourceDefaultId: report.body._id,
    });
    await expect(AuctionSanction.countDocuments()).resolves.toBe(0);
    await expect(Audit.exists({ action: auctionDefaultAuditActions.confirmed })).resolves.toBeTruthy();

    const second = await createClosedAuctionListingWithWinner();
    const rejectedReport = await request(app)
      .post(`/auction-listings/${second.auctionListing?._id}/defaults`)
      .set('Authorization', bearer(createAccessToken(second.seller._id, 'user')))
      .send({
        reportedUserId: String(second.winner._id),
        category: 'buyer_refused',
        description: 'Buyer refused to continue after winning.',
      })
      .expect(201);
    await request(app)
      .post(`/admin/auction-defaults/${rejectedReport.body._id}/reject`)
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .send({ resolutionType: 'insufficient_evidence' })
      .expect(200);
    await expect(Audit.exists({ action: auctionDefaultAuditActions.rejected })).resolves.toBeTruthy();
  });

  it('builds recommendations from PCC without creating sanctions and applies sanctions explicitly', async () => {
    const superUser = await createTestUser('super');
    await setConfig({
      key: 'auction.sanctions.firstOffenseDays',
      environment: 'sandbox',
      valueType: 'number',
      value: 45,
      changedBy: superUser._id,
    });
    const context = await createConfirmedDefault('buyer');

    const recommendation = await buildAuctionSanctionRecommendation(context.report._id);
    expect(recommendation).toMatchObject({
      offenseNumber: 1,
      recommendedAction: 'temporary_suspension',
      recommendedDurationDays: 45,
    });
    await expect(AuctionSanction.countDocuments()).resolves.toBe(0);

    const sanction = await request(app)
      .post('/admin/auction-sanctions/apply')
      .set('Authorization', bearer(createAccessToken(context.admin._id, 'admin')))
      .send({ recommendation })
      .expect(201);
    expect(sanction.body).toMatchObject({ type: 'buyer', offenseNumber: 1, status: 'active' });
    await request(app)
      .post('/admin/auction-sanctions/apply')
      .set('Authorization', bearer(createAccessToken(context.admin._id, 'admin')))
      .send({ recommendation })
      .expect(409);
    await expect(Audit.exists({ action: auctionSanctionAuditActions.applied })).resolves.toBeTruthy();
  });

  it('revokes sanctions and enforces buyer and seller active sanctions', async () => {
    const buyerSanction = await applyConfirmedDefault('buyer');
    const otherSeller = await createTestUser('user');
    const { auctionListing } = await createAuctionListingForSeller(otherSeller._id);
    await request(app)
      .post(`/auction-listings/${auctionListing._id}/bids`)
      .set('Authorization', bearer(createAccessToken(buyerSanction.reported._id, 'user')))
      .send({ amount: 50_000 })
      .expect(403)
      .expect((res) => {
        expect(res.body.error).toBe('AUCTION_BUYER_SANCTION_ACTIVE');
      });

    const sellerSanction = await applyConfirmedDefault('seller');
    const listing = await createTestListing(sellerSanction.reported._id);
    await request(app)
      .post('/auction-listings')
      .set('Authorization', bearer(createAccessToken(sellerSanction.reported._id, 'user')))
      .send({ listingId: String(listing._id), startingPrice: 50_000 })
      .expect(403)
      .expect((res) => {
        expect(res.body.error).toBe('AUCTION_SELLER_SANCTION_ACTIVE');
      });

    await request(app)
      .post(`/admin/auction-sanctions/${buyerSanction.sanction._id}/revoke`)
      .set('Authorization', bearer(createAccessToken(buyerSanction.admin._id, 'admin')))
      .expect(200);
    await expect(AuctionSanction.findById(buyerSanction.sanction._id).then((doc) => doc?.status))
      .resolves.toBe('revoked');
    await expect(Audit.exists({ action: auctionSanctionAuditActions.revoked })).resolves.toBeTruthy();
  });

  it('supports appeals only when PCC allows them and waiting period elapsed', async () => {
    const superUser = await createTestUser('super');
    const context = await applyConfirmedDefault('buyer');

    await request(app)
      .post(`/auction-sanctions/${context.sanction._id}/appeals`)
      .set('Authorization', bearer(createAccessToken(context.reported._id, 'user')))
      .send({ reason: 'I need an administrative review of this sanction.' })
      .expect(409);

    await setConfig({
      key: 'auction.sanctions.appealWaitingDays',
      environment: 'sandbox',
      valueType: 'number',
      value: 0,
      changedBy: superUser._id,
    });

    const appeal = await request(app)
      .post(`/auction-sanctions/${context.sanction._id}/appeals`)
      .set('Authorization', bearer(createAccessToken(context.reported._id, 'user')))
      .send({ reason: 'I need an administrative review of this sanction.', evidence: { note: 'safe' } })
      .expect(201);
    await request(app)
      .post(`/auction-sanctions/${context.sanction._id}/appeals`)
      .set('Authorization', bearer(createAccessToken(context.reported._id, 'user')))
      .send({ reason: 'A second active appeal should be blocked.' })
      .expect(409);

    await request(app)
      .post(`/admin/auction-appeals/${appeal.body._id}/approve`)
      .set('Authorization', bearer(createAccessToken(context.admin._id, 'admin')))
      .send({ resolution: 'Approved after review.' })
      .expect(200);
    await expect(AuctionAppeal.findById(appeal.body._id).then((doc) => doc?.status)).resolves.toBe('approved');
    await expect(AuctionSanction.findById(context.sanction._id).then((doc) => doc?.status)).resolves.toBe('revoked');
    await expect(Audit.exists({ action: auctionAppealAuditActions.requested })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: auctionAppealAuditActions.approved })).resolves.toBeTruthy();
  });

  it('exposes admin aggregate metrics without sensitive default, sanction or appeal details', async () => {
    const context = await applyConfirmedDefault('buyer');
    const superUser = await createTestUser('super');
    await setConfig({
      key: 'auction.sanctions.appealWaitingDays',
      environment: 'sandbox',
      valueType: 'number',
      value: 0,
      changedBy: superUser._id,
    });
    await request(app)
      .post(`/auction-sanctions/${context.sanction._id}/appeals`)
      .set('Authorization', bearer(createAccessToken(context.reported._id, 'user')))
      .send({ reason: 'Please review this sanction after the waiting period.' })
      .expect(201);

    const dashboard = await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(createAccessToken(context.admin._id, 'admin')))
      .expect(200);
    expect(dashboard.body.auctionDefaults).toMatchObject({ total: 1, pending: 0, confirmed: 1, rejected: 0 });
    expect(dashboard.body.auctionSanctions).toMatchObject({ active: 1, expired: 0, permanent: 0 });
    expect(dashboard.body.auctionAppeals).toMatchObject({ requested: 1, underReview: 0, approved: 0, rejected: 0 });
    expect(JSON.stringify(dashboard.body.auctionDefaults)).not.toContain(String(context.reported._id));
    expect(JSON.stringify(dashboard.body.auctionSanctions)).not.toContain(context.sanction._id);
  });
});
