import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Auction } from '../../domain/auctions/auction.model';
import { Bid } from '../../domain/auctions/bid.model';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createLiveAuction, createTestListing, createTestUser } from '../../test/helpers/factories';

describe('auction admin permissions', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
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
});
