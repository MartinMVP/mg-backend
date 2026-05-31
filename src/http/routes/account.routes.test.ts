import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuctionResult } from '../../domain/auctionResults/auctionResult.model';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createLiveAuction, createTestListing, createTestUser } from '../../test/helpers/factories';

describe('account auction results routes', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  async function createClosedResultFor(sellerId: any, buyerId: any, finalPrice = 1500) {
    const listing = await createTestListing(sellerId);
    const auction = await createLiveAuction({
      listing: listing._id,
      state: 'closed',
      currentPrice: finalPrice,
      currentWinner: buyerId,
      endsAt: new Date(Date.now() - 60_000),
    });

    return AuctionResult.create({
      auctionId: auction._id,
      listingId: listing._id,
      sellerId,
      buyerId,
      finalPrice,
      closedAt: new Date(),
      status: 'pending_contact',
    });
  }

  it('lists only purchases for the authenticated buyer', async () => {
    const buyer = await createTestUser('user');
    const otherBuyer = await createTestUser('user');
    const seller = await createTestUser('user');
    const token = createAccessToken(String(buyer._id), 'user');

    const ownResult = await createClosedResultFor(seller._id, buyer._id, 1800);
    await createClosedResultFor(seller._id, otherBuyer._id, 2200);

    const res = await request(app)
      .get('/account/purchases')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]._id).toBe(String(ownResult._id));
    expect(res.body[0]).toMatchObject({
      finalPrice: 1800,
      status: 'pending_contact',
    });
    expect(res.body[0].closedAt).toEqual(expect.any(String));
    expect(res.body[0].auctionId).toBeTruthy();
    expect(res.body[0].listingId?.animal?.breed).toBeTruthy();
  });

  it('lists only sales for the authenticated seller and includes buyer name', async () => {
    const seller = await createTestUser('user');
    const otherSeller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const token = createAccessToken(String(seller._id), 'user');

    const ownResult = await createClosedResultFor(seller._id, buyer._id, 2500);
    await createClosedResultFor(otherSeller._id, buyer._id, 3100);

    const res = await request(app)
      .get('/account/sales')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]._id).toBe(String(ownResult._id));
    expect(res.body[0]).toMatchObject({
      finalPrice: 2500,
      status: 'pending_contact',
    });
    expect(res.body[0].closedAt).toEqual(expect.any(String));
    expect(res.body[0].buyerId).toMatchObject({ name: buyer.name });
    expect(res.body[0].buyerId).not.toHaveProperty('email');
    expect(res.body[0].auctionId).toBeTruthy();
    expect(res.body[0].listingId?.animal?.breed).toBeTruthy();
  });

  it.each(['/account/purchases', '/account/sales'])(
    'returns 401 for unauthenticated requests to %s',
    async (path) => {
      const res = await request(app).get(path);

      expect(res.status).toBe(401);
    }
  );
});
