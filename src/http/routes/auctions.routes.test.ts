import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuctionResult } from '../../domain/auctionResults/auctionResult.model';
import { Auction } from '../../domain/auctions/auction.model';
import { Bid } from '../../domain/auctions/bid.model';
import { Notification } from '../../domain/notifications/notification.model';
import { closeExpiredAuctions } from '../../jobs/auctionScheduler';
import { emitAuctionStateChanged } from '../../realtime/socket';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createLiveAuction, createTestListing, createTestUser } from '../../test/helpers/factories';

vi.mock('../../realtime/socket', () => ({
  emitAuctionBidAccepted: vi.fn(),
  emitAuctionStateChanged: vi.fn(),
}));

describe('auction admin permissions', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function authHeader(role: 'user' | 'super') {
    const user = await createTestUser(role);
    return {
      user,
      authorization: bearer(createAccessToken(String(user._id), role)),
    };
  }

  it.each([
    ['POST /auctions', async (authorization: string) => {
      const listing = await createTestListing();
      return request(app)
        .post('/auctions')
        .set('Authorization', authorization)
        .send({
          title: 'Forbidden auction',
          listing: String(listing._id),
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: new Date(Date.now() + 60_000).toISOString(),
          startPrice: 1000,
          minIncrement: 100,
        });
    }],
    ['POST /auctions/:id/open', async (authorization: string) => {
      const auction = await createLiveAuction({ state: 'scheduled' });
      return request(app).post(`/auctions/${auction._id}/open`).set('Authorization', authorization);
    }],
    ['POST /auctions/:id/pause', async (authorization: string) => {
      const auction = await createLiveAuction({ state: 'live' });
      return request(app).post(`/auctions/${auction._id}/pause`).set('Authorization', authorization);
    }],
    ['POST /auctions/:id/resume', async (authorization: string) => {
      const auction = await createLiveAuction({ state: 'paused' });
      return request(app).post(`/auctions/${auction._id}/resume`).set('Authorization', authorization);
    }],
    ['POST /auctions/:id/close', async (authorization: string) => {
      const auction = await createLiveAuction({ state: 'live' });
      return request(app).post(`/auctions/${auction._id}/close`).set('Authorization', authorization);
    }],
  ])('%s returns 403 for role user', async (_label, buildRequest) => {
    const { authorization } = await authHeader('user');
    const res = await buildRequest(authorization);

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('allows role super to create an auction', async () => {
    const { user, authorization } = await authHeader('super');
    const listing = await createTestListing(user._id);

    const res = await request(app)
      .post('/auctions')
      .set('Authorization', authorization)
      .send({
        title: 'Super auction',
        listing: String(listing._id),
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 60_000).toISOString(),
        startPrice: 1000,
        minIncrement: 100,
      });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Super auction');

    const created = await Auction.findById(res.body._id);
    expect(created).toBeTruthy();
  });

  it('keeps bidding available for authenticated role user', async () => {
    const { user, authorization } = await authHeader('user');
    const auction = await createLiveAuction({
      currentPrice: 1000,
      minIncrement: 100,
    });

    const res = await request(app)
      .post(`/auctions/${auction._id}/bid`)
      .set('Authorization', authorization)
      .send({ amount: 1100 });

    expect(res.status).toBe(200);
    expect(res.body.currentPrice).toBe(1100);
    expect(String(res.body.currentWinner)).toBe(String(user._id));

    const bid = await Bid.findOne({ auction: auction._id });
    expect(bid).toBeTruthy();
    expect(String(bid?.bidder)).toBe(String(user._id));
  });

  it.each([
    ['open', 'scheduled', 'live'],
    ['pause', 'live', 'paused'],
    ['resume', 'paused', 'live'],
    ['close', 'live', 'closed'],
  ])('emits state_changed when admin %s changes auction state', async (action, initialState, nextState) => {
    const { authorization } = await authHeader('super');
    const auction = await createLiveAuction({
      state: initialState,
      currentPrice: 1000,
    });

    const res = await request(app)
      .post(`/auctions/${auction._id}/${action}`)
      .set('Authorization', authorization);

    expect(res.status).toBe(200);
    expect(emitAuctionStateChanged).toHaveBeenCalledWith(
      String(auction._id),
      expect.objectContaining({
        auctionId: String(auction._id),
        state: nextState,
        endsAt: expect.any(String),
        currentWinner: null,
        currentPrice: 1000,
      })
    );

    if (nextState === 'closed') {
      expect(emitAuctionStateChanged).toHaveBeenCalledWith(
        String(auction._id),
        expect.objectContaining({ finalPrice: 1000 })
      );
    }
  });

  it('creates AuctionResult and notifications when admin closes an auction with winner', async () => {
    const { authorization } = await authHeader('super');
    const winner = await createTestUser('user');
    const auction = await createLiveAuction({
      state: 'live',
      currentPrice: 2500,
      currentWinner: winner._id,
    });

    const res = await request(app)
      .post(`/auctions/${auction._id}/close`)
      .set('Authorization', authorization);

    expect(res.status).toBe(200);

    const result = await AuctionResult.findOne({ auctionId: auction._id });
    const notifications = await Notification.find({}).sort({ type: 1 });

    expect(result).toBeTruthy();
    expect(String(result?.listingId)).toBe(String(auction.listing));
    expect(String(result?.buyerId)).toBe(String(winner._id));
    expect(result?.finalPrice).toBe(2500);
    expect(result?.status).toBe('pending_contact');
    expect(notifications).toHaveLength(2);
    expect(notifications.map((n) => n.type).sort()).toEqual(['auction_closed', 'auction_won']);
  });

  it('does not duplicate AuctionResult or notifications when admin close is repeated', async () => {
    const { authorization } = await authHeader('super');
    const winner = await createTestUser('user');
    const auction = await createLiveAuction({
      state: 'live',
      currentPrice: 2600,
      currentWinner: winner._id,
    });

    await request(app)
      .post(`/auctions/${auction._id}/close`)
      .set('Authorization', authorization)
      .expect(200);

    await request(app)
      .post(`/auctions/${auction._id}/close`)
      .set('Authorization', authorization)
      .expect(409);

    expect(await AuctionResult.countDocuments({ auctionId: auction._id })).toBe(1);
    expect(await Notification.countDocuments()).toBe(2);
  });

  it('does not duplicate post-auction flow when scheduler runs after manual close', async () => {
    const { authorization } = await authHeader('super');
    const winner = await createTestUser('user');
    const auction = await createLiveAuction({
      state: 'live',
      endsAt: new Date(Date.now() - 60_000),
      currentPrice: 2700,
      currentWinner: winner._id,
    });

    await request(app)
      .post(`/auctions/${auction._id}/close`)
      .set('Authorization', authorization)
      .expect(200);

    await closeExpiredAuctions();

    const freshAuction = await Auction.findById(auction._id);
    expect(freshAuction?.state).toBe('closed');
    expect(await AuctionResult.countDocuments({ auctionId: auction._id })).toBe(1);
    expect(await Notification.countDocuments()).toBe(2);
  });
});
