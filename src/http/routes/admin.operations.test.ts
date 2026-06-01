import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuctionResult, AuctionResultStatus } from '../../domain/auctionResults/auctionResult.model';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createLiveAuction, createTestListing, createTestUser } from '../../test/helpers/factories';

describe('GET /admin/operations', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  async function createOperation(status: AuctionResultStatus = 'pending_contact') {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const listing = await createTestListing(seller._id);
    const auction = await createLiveAuction({
      listing: listing._id,
      state: 'closed',
      currentWinner: buyer._id,
      currentPrice: 2000,
      endsAt: new Date(Date.now() - 60_000),
    });

    return AuctionResult.create({
      auctionId: auction._id,
      listingId: listing._id,
      sellerId: seller._id,
      buyerId: buyer._id,
      finalPrice: 2000,
      closedAt: new Date(),
      status,
    });
  }

  it('returns 403 for role user', async () => {
    const user = await createTestUser('user');
    const token = createAccessToken(String(user._id), 'user');

    const res = await request(app)
      .get('/admin/operations')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('returns 200 for role admin', async () => {
    const admin = await createTestUser('admin');
    const token = createAccessToken(String(admin._id), 'admin');
    await createOperation();

    const res = await request(app)
      .get('/admin/operations')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      finalPrice: 2000,
      status: 'pending_contact',
    });
    expect(res.body.items[0].auctionId).toBeTruthy();
    expect(res.body.items[0].animal).toBeTruthy();
    expect(res.body.items[0].seller).toHaveProperty('name');
    expect(res.body.items[0].buyer).toHaveProperty('name');
  });

  it('returns 200 for role super', async () => {
    const superUser = await createTestUser('super');
    const token = createAccessToken(String(superUser._id), 'super');
    await createOperation();

    const res = await request(app)
      .get('/admin/operations')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('filters by status', async () => {
    const admin = await createTestUser('admin');
    const token = createAccessToken(String(admin._id), 'admin');
    const confirmed = await createOperation('sale_confirmed');
    await createOperation('sale_cancelled');

    const res = await request(app)
      .get('/admin/operations?status=sale_confirmed')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]._id).toBe(String(confirmed._id));
    expect(res.body.items[0].status).toBe('sale_confirmed');
  });
});
