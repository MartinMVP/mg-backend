import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Auction } from '../../domain/auctions/auction.model';
import { Bid } from '../../domain/auctions/bid.model';
import { emitAuctionBidAccepted } from '../../realtime/socket';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createLiveAuction, createTestUser } from '../../test/helpers/factories';

vi.mock('../../realtime/socket', () => ({
  emitAuctionBidAccepted: vi.fn(),
  emitAuctionStateChanged: vi.fn(),
}));

describe('POST /auctions/:id/bid', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 and does not create a bid when amount is too low', async () => {
    const bidder = await createTestUser('user');
    const auction = await createLiveAuction({
      currentPrice: 1000,
      minIncrement: 100,
    });
    const token = createAccessToken(String(bidder._id), 'user');

    const res = await request(app)
      .post(`/auctions/${auction._id}/bid`)
      .set('Authorization', bearer(token))
      .send({ amount: 1050 });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Bid too low', min: 1100 });

    const bidCount = await Bid.countDocuments({ auction: auction._id });
    const freshAuction = await Auction.findById(auction._id);

    expect(bidCount).toBe(0);
    expect(freshAuction?.currentPrice).toBe(1000);
    expect(freshAuction?.currentWinner).toBeUndefined();
  });

  it('returns 200, updates current price and winner, and creates a bid', async () => {
    const bidder = await createTestUser('user');
    const auction = await createLiveAuction({
      currentPrice: 1000,
      minIncrement: 100,
    });
    const token = createAccessToken(String(bidder._id), 'user');

    const res = await request(app)
      .post(`/auctions/${auction._id}/bid`)
      .set('Authorization', bearer(token))
      .send({ amount: 1100 });

    expect(res.status).toBe(200);
    expect(res.body.currentPrice).toBe(1100);
    expect(String(res.body.currentWinner)).toBe(String(bidder._id));
    expect(res.body.lastBid).toMatchObject({ amount: 1100 });

    const bids = await Bid.find({ auction: auction._id });
    const freshAuction = await Auction.findById(auction._id);

    expect(bids).toHaveLength(1);
    expect(bids[0].amount).toBe(1100);
    expect(String(bids[0].bidder)).toBe(String(bidder._id));
    expect(freshAuction?.currentPrice).toBe(1100);
    expect(String(freshAuction?.currentWinner)).toBe(String(bidder._id));
    expect(emitAuctionBidAccepted).toHaveBeenCalledWith(
      String(auction._id),
      expect.objectContaining({
        auctionId: String(auction._id),
        user: String(bidder._id),
        amount: 1100,
        currentPrice: 1100,
        bid: expect.objectContaining({
          auction: String(auction._id),
          bidder: String(bidder._id),
          amount: 1100,
        }),
      })
    );
  });

  it('returns 400 for an invalid auction ObjectId', async () => {
    const bidder = await createTestUser('user');
    const token = createAccessToken(String(bidder._id), 'user');

    const res = await request(app)
      .post('/auctions/not-an-object-id/bid')
      .set('Authorization', bearer(token))
      .send({ amount: 1100 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid auction id' });
  });

  it.each(['abc', 'NaN', 'Infinity', 0, -10])(
    'returns 400 and does not mutate auction for invalid amount %s',
    async (amount) => {
      const bidder = await createTestUser('user');
      const auction = await createLiveAuction({
        currentPrice: 1000,
        minIncrement: 100,
      });
      const token = createAccessToken(String(bidder._id), 'user');

      const res = await request(app)
        .post(`/auctions/${auction._id}/bid`)
        .set('Authorization', bearer(token))
        .send({ amount });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid bid amount' });

      const bidCount = await Bid.countDocuments({ auction: auction._id });
      const freshAuction = await Auction.findById(auction._id);

      expect(bidCount).toBe(0);
      expect(freshAuction?.currentPrice).toBe(1000);
      expect(freshAuction?.currentWinner).toBeUndefined();
    }
  );
});

describe('GET /auctions/:id/bids', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  it('does not expose bidder email or role', async () => {
    const bidder = await createTestUser('user');
    const auction = await createLiveAuction({
      currentPrice: 1100,
      currentWinner: bidder._id,
    });

    await Bid.create({
      auction: auction._id,
      listing: auction.listing,
      bidder: bidder._id,
      amount: 1100,
    });

    const res = await request(app).get(`/auctions/${auction._id}/bids`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].bidder).toMatchObject({ name: bidder.name });
    expect(res.body[0].bidder).not.toHaveProperty('email');
    expect(res.body[0].bidder).not.toHaveProperty('role');
  });
});
