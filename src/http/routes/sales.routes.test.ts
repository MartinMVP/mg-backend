import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuctionResult } from '../../domain/auctionResults/auctionResult.model';
import { Notification } from '../../domain/notifications/notification.model';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createLiveAuction, createTestListing, createTestUser } from '../../test/helpers/factories';

describe('sales confirmation routes', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  async function createSaleResult(sellerId: any, buyerId: any, status = 'pending_contact') {
    const listing = await createTestListing(sellerId);
    const auction = await createLiveAuction({
      listing: listing._id,
      state: 'closed',
      currentPrice: 2000,
      currentWinner: buyerId,
      endsAt: new Date(Date.now() - 60_000),
    });

    return AuctionResult.create({
      auctionId: auction._id,
      listingId: listing._id,
      sellerId,
      buyerId,
      finalPrice: 2000,
      closedAt: new Date(),
      status,
    });
  }

  it('allows the seller to confirm a sale', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(seller._id), 'user');

    const res = await request(app)
      .post(`/sales/${sale._id}/confirm`)
      .set('Authorization', bearer(token));

    const freshSale = await AuctionResult.findById(sale._id);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('sale_confirmed');
    expect(freshSale?.status).toBe('sale_confirmed');
  });

  it('allows the seller to cancel a sale and notifies the buyer', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(seller._id), 'user');

    const res = await request(app)
      .post(`/sales/${sale._id}/cancel`)
      .set('Authorization', bearer(token));

    const notification = await Notification.findOne({
      userId: buyer._id,
      type: 'sale_cancelled',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('sale_cancelled');
    expect(notification).toBeTruthy();
  });

  it.each(['confirm', 'cancel'])('rejects buyer attempts to %s a sale', async (action) => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(buyer._id), 'user');

    const res = await request(app)
      .post(`/sales/${sale._id}/${action}`)
      .set('Authorization', bearer(token));

    const freshSale = await AuctionResult.findById(sale._id);

    expect(res.status).toBe(403);
    expect(freshSale?.status).toBe('pending_contact');
  });

  it.each(['confirm', 'cancel'])('rejects another user attempts to %s a sale', async (action) => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const other = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(other._id), 'user');

    const res = await request(app)
      .post(`/sales/${sale._id}/${action}`)
      .set('Authorization', bearer(token));

    const freshSale = await AuctionResult.findById(sale._id);

    expect(res.status).toBe(403);
    expect(freshSale?.status).toBe('pending_contact');
  });

  it('does not allow confirming a sale twice', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(seller._id), 'user');

    const first = await request(app)
      .post(`/sales/${sale._id}/confirm`)
      .set('Authorization', bearer(token));
    const second = await request(app)
      .post(`/sales/${sale._id}/confirm`)
      .set('Authorization', bearer(token));

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: 'Sale already finalized' });
  });

  it('notifies the buyer when a sale is confirmed', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(seller._id), 'user');

    const res = await request(app)
      .post(`/sales/${sale._id}/confirm`)
      .set('Authorization', bearer(token));

    const notification = await Notification.findOne({
      userId: buyer._id,
      type: 'sale_confirmed',
    });

    expect(res.status).toBe(200);
    expect(notification).toBeTruthy();
    expect(notification?.read).toBe(false);
  });
});
