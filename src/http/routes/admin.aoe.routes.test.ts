import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Audit } from '../../domain/audit/audit.model';
import { AOECase } from '../../domain/aoe/aoeCase.model';
import { aoeCaseAuditActions, createPlatformAOECase } from '../../domain/aoe/aoeCase.service';
import { getAOECapabilities } from '../../domain/aoe/aoeCapabilities.service';
import { classifyAOECase } from '../../domain/aoe/aoeClassification.service';
import { AOEDecisionProposal } from '../../domain/aoe/aoeDecisionProposal.model';
import {
  aoeDecisionProposalAuditActions,
  buildAOEDecisionProposal,
} from '../../domain/aoe/aoeDecisionProposal.service';
import { AOEEvidence } from '../../domain/aoe/aoeEvidence.model';
import { addAOEEvidence, aoeEvidenceAuditActions } from '../../domain/aoe/aoeEvidence.service';
import { shouldEscalateToAdmin } from '../../domain/aoe/aoeEscalation.service';
import { AuctionListing } from '../../domain/auctionListings/auctionListing.model';
import { closeAuctionListing } from '../../domain/auctionListings/auctionListing.service';
import { AuctionSanction } from '../../domain/auctionSanctions/auctionSanction.model';
import { MembershipPlan, MembershipBenefits } from '../../domain/memberships/membershipPlan.model';
import { MembershipUsage } from '../../domain/memberships/membershipUsage.model';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { seedSandboxDefaultConfigurations, setConfig } from '../../domain/platformConfiguration/platformConfiguration.service';
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
        name: 'AOE business',
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
  return { seller, winner, auctionListing: await AuctionListing.findById(created.body._id).lean() };
}

async function createConfirmedDefault() {
  const context = await createClosedAuctionListingWithWinner();
  const admin = await createTestUser('admin');
  const report = await request(app)
    .post(`/auction-listings/${context.auctionListing?._id}/defaults`)
    .set('Authorization', bearer(createAccessToken(context.seller._id, 'user')))
    .send({
      reportedUserId: String(context.winner._id),
      category: 'buyer_refused',
      description: 'Buyer refused to complete after winning the auction.',
    })
    .expect(201);
  const confirmed = await request(app)
    .post(`/admin/auction-defaults/${report.body._id}/confirm`)
    .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
    .send({})
    .expect(200);
  return { ...context, admin, report: report.body, confirmed: confirmed.body };
}

async function applySanctionFromConfirmedDefault() {
  const context = await createConfirmedDefault();
  const sanction = await request(app)
    .post('/admin/auction-sanctions/apply')
    .set('Authorization', bearer(createAccessToken(context.admin._id, 'admin')))
    .send({ recommendation: context.confirmed.recommendation })
    .expect(201);
  return { ...context, sanction: sanction.body };
}

describe('AOE foundation routes and services', () => {
  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  it('creates AOE cases, append-only evidence, decision proposals and required audit events', async () => {
    const aoeCase = await createPlatformAOECase({
      type: 'auction_default',
      entityType: 'auction',
      entityId: new Types.ObjectId(),
      priority: 'medium',
    });
    const evidence = await addAOEEvidence({
      aoeCaseId: aoeCase._id,
      sourceType: 'auction',
      sourceId: new Types.ObjectId(),
      summary: 'buyer default confirmed',
      confidence: 82,
    });
    await expect(AOEEvidence.updateOne({ _id: evidence._id }, { $set: { summary: 'changed' } }))
      .rejects.toThrow('aoe_evidence_append_only');

    const proposal = await buildAOEDecisionProposal(aoeCase._id);
    expect(proposal.confidenceReason.length).toBeGreaterThan(0);
    expect(proposal.learningFeedback).toBe('unresolved');
    expect(await Audit.exists({ action: aoeCaseAuditActions.created })).toBeTruthy();
    expect(await Audit.exists({ action: aoeEvidenceAuditActions.added })).toBeTruthy();
    expect(await Audit.exists({ action: aoeDecisionProposalAuditActions.created })).toBeTruthy();
  });

  it('exposes capabilities with execution=false and uses PCC AOE defaults', async () => {
    const superUser = await createTestUser('super');
    await seedSandboxDefaultConfigurations(superUser._id);
    expect(getAOECapabilities()).toMatchObject({
      evidence: true,
      classification: true,
      decisionProposal: true,
      escalation: true,
      execution: false,
    });
    await request(app)
      .get('/admin/aoe/capabilities')
      .set('Authorization', bearer(createAccessToken(superUser._id, 'super')))
      .expect(200)
      .expect((res) => {
        expect(res.body.execution).toBe(false);
      });
  });

  it('classifies, builds proposals and escalates mandatory signals without executing actions', async () => {
    const classification = classifyAOECase(
      { type: 'fraud_signal', priority: 'high' },
      [{ summary: 'possible fraud evidence', confidence: 90 }]
    );
    expect(classification).toBe('possible_fraud');
    expect(shouldEscalateToAdmin({ classification })).toBe(true);
    expect(shouldEscalateToAdmin({ classification: 'third_offense' })).toBe(true);

    const aoeCase = await createPlatformAOECase({
      type: 'fraud_signal',
      entityType: 'platform',
      entityId: new Types.ObjectId(),
      priority: 'critical',
    });
    await addAOEEvidence({
      aoeCaseId: aoeCase._id,
      sourceType: 'audit',
      sourceId: new Types.ObjectId(),
      summary: 'possible fraud and contradictory evidence',
      confidence: 95,
    });
    const proposal = await buildAOEDecisionProposal(aoeCase._id);
    expect(proposal.proposalType).toBe('escalate');
    expect(await AuctionSanction.countDocuments()).toBe(0);
  });

  it('creates AOE case, evidence and proposal when auction default is confirmed, but no sanction', async () => {
    await createConfirmedDefault();
    await expect(AOECase.countDocuments({ type: 'auction_default' })).resolves.toBe(1);
    await expect(AOEEvidence.countDocuments()).resolves.toBe(1);
    await expect(AOEDecisionProposal.countDocuments()).resolves.toBe(1);
    await expect(AuctionSanction.countDocuments()).resolves.toBe(0);
  });

  it('observes sanction applied and appeal requested/approved events', async () => {
    const superUser = await createTestUser('super');
    await setConfig({
      key: 'auction.sanctions.appealWaitingDays',
      environment: 'sandbox',
      valueType: 'number',
      value: 0,
      changedBy: superUser._id,
    });
    const context = await applySanctionFromConfirmedDefault();
    await request(app)
      .post(`/auction-sanctions/${context.sanction._id}/appeals`)
      .set('Authorization', bearer(createAccessToken(context.winner._id, 'user')))
      .send({ reason: 'Please review this sanction with administrative evidence.' })
      .expect(201);
    const appealCase = await AOECase.findOne({ type: 'appeal_review' }).sort({ createdAt: -1 }).lean();
    expect(appealCase?.status).toBe('escalated');

    const proposal = await AOEDecisionProposal.findOne({ aoeCaseId: appealCase?._id }).lean();
    expect(proposal?.proposalType).toBe('escalate');
    await request(app)
      .post(`/admin/auction-appeals/${String(appealCase?.entityId)}/approve`)
      .set('Authorization', bearer(createAccessToken(context.admin._id, 'admin')))
      .send({ resolution: 'Approved manually.' })
      .expect(200);
    await expect(AOECase.countDocuments({ type: 'sanction_review' })).resolves.toBe(1);
    await expect(AOECase.countDocuments({ type: 'appeal_review' })).resolves.toBe(2);
  });

  it('respects PCC when decision proposal generation is disabled', async () => {
    const superUser = await createTestUser('super');
    await setConfig({
      key: 'aoe.generateDecisionProposals',
      environment: 'sandbox',
      valueType: 'boolean',
      value: false,
      changedBy: superUser._id,
    });
    await createConfirmedDefault();
    await expect(AOECase.countDocuments({ type: 'auction_default' })).resolves.toBe(1);
    await expect(AOEEvidence.countDocuments()).resolves.toBe(1);
    await expect(AOEDecisionProposal.countDocuments()).resolves.toBe(0);
  });

  it('supports admin endpoints and dashboard metrics', async () => {
    const { admin } = await createConfirmedDefault();
    const adminToken = createAccessToken(admin._id, 'admin');
    const list = await request(app)
      .get('/admin/aoe/cases?page=1&limit=1')
      .set('Authorization', bearer(adminToken))
      .expect(200);
    expect(list.body.total).toBe(1);
    const caseId = list.body.cases[0]._id;

    await request(app).get(`/admin/aoe/cases/${caseId}`).set('Authorization', bearer(adminToken)).expect(200);
    await request(app).get(`/admin/aoe/cases/${caseId}/evidence`).set('Authorization', bearer(adminToken)).expect(200);
    const proposals = await request(app)
      .get(`/admin/aoe/cases/${caseId}/proposals`)
      .set('Authorization', bearer(adminToken))
      .expect(200);
    const proposalId = proposals.body.proposals[0]._id;
    await request(app).post(`/admin/aoe/cases/${caseId}/view`).set('Authorization', bearer(adminToken)).expect(200);
    await request(app).post(`/admin/aoe/cases/${caseId}/escalate`).set('Authorization', bearer(adminToken)).expect(200);
    await request(app).post(`/admin/aoe/proposals/${proposalId}/view`).set('Authorization', bearer(adminToken)).expect(200);
    await request(app).post(`/admin/aoe/proposals/${proposalId}/escalate`).set('Authorization', bearer(adminToken)).expect(200);
    await request(app).post(`/admin/aoe/proposals/${proposalId}/close`).set('Authorization', bearer(adminToken)).expect(200);
    await request(app).post(`/admin/aoe/cases/${caseId}/close`).set('Authorization', bearer(adminToken)).expect(200);

    const dashboard = await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(adminToken))
      .expect(200);
    expect(dashboard.body.aoe).toMatchObject({
      closedCases: 1,
      closedProposals: 1,
    });
    await expect(Audit.exists({ action: aoeCaseAuditActions.viewed })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: aoeCaseAuditActions.escalated })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: aoeCaseAuditActions.closed })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: aoeDecisionProposalAuditActions.viewed })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: aoeDecisionProposalAuditActions.escalated })).resolves.toBeTruthy();
    await expect(Audit.exists({ action: aoeDecisionProposalAuditActions.closed })).resolves.toBeTruthy();
  });

  it('blocks non-admin access to AOE endpoints', async () => {
    const user = await createTestUser('user');
    await request(app)
      .get('/admin/aoe/cases')
      .set('Authorization', bearer(createAccessToken(user._id, 'user')))
      .expect(403);
  });
});
