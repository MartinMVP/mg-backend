import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuctionResult } from '../../domain/auctionResults/auctionResult.model';
import { FiscalProfile } from '../../domain/fiscalProfiles/fiscalProfile.model';
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

describe('account fiscal profile routes', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  const fiscalPayload = {
    rfc: 'XAXX010101000',
    razonSocial: 'Rancho Fiscal SA de CV',
    regimenFiscal: '601',
    codigoPostal: '83000',
    usoCFDI: 'G03',
  };

  it('allows a user to create a fiscal profile with billing email', async () => {
    const user = await createTestUser('user');
    const token = createAccessToken(String(user._id), 'user');

    const res = await request(app)
      .post('/account/fiscal-profile')
      .set('Authorization', bearer(token))
      .send({
        ...fiscalPayload,
        emailFacturacion: 'facturas@rancho.test',
      });

    const stored = await FiscalProfile.findOne({ userId: user._id });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ...fiscalPayload,
      emailFacturacion: 'facturas@rancho.test',
      isValidated: false,
    });
    expect(stored).toBeTruthy();
    expect(stored?.rfc).toBe(fiscalPayload.rfc);
    expect(stored?.isValidated).toBe(false);
  });

  it('rejects an invalid codigoPostal', async () => {
    const user = await createTestUser('user');
    const token = createAccessToken(String(user._id), 'user');

    const res = await request(app)
      .post('/account/fiscal-profile')
      .set('Authorization', bearer(token))
      .send({
        ...fiscalPayload,
        codigoPostal: '8300A',
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Código postal inválido' });
  });

  it('rejects an invalid RFC', async () => {
    const user = await createTestUser('user');
    const token = createAccessToken(String(user._id), 'user');

    const res = await request(app)
      .post('/account/fiscal-profile')
      .set('Authorization', bearer(token))
      .send({
        ...fiscalPayload,
        rfc: 'RFC-MALO',
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'RFC inválido' });
  });

  it('allows a user to update a fiscal profile', async () => {
    const user = await createTestUser('user');
    const token = createAccessToken(String(user._id), 'user');

    await request(app)
      .post('/account/fiscal-profile')
      .set('Authorization', bearer(token))
      .send(fiscalPayload);

    const res = await request(app)
      .post('/account/fiscal-profile')
      .set('Authorization', bearer(token))
      .send({
        ...fiscalPayload,
        razonSocial: 'Rancho Actualizado SA de CV',
        codigoPostal: '83100',
      });

    const count = await FiscalProfile.countDocuments({ userId: user._id });

    expect(res.status).toBe(200);
    expect(res.body.razonSocial).toBe('Rancho Actualizado SA de CV');
    expect(res.body.codigoPostal).toBe('83100');
    expect(count).toBe(1);
  });

  it('allows a user to get their fiscal profile', async () => {
    const user = await createTestUser('user');
    const token = createAccessToken(String(user._id), 'user');

    await FiscalProfile.create({
      userId: user._id,
      ...fiscalPayload,
    });

    const res = await request(app)
      .get('/account/fiscal-profile')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject(fiscalPayload);
    expect(res.body.userId).toBe(String(user._id));
  });

  it('does not expose another user fiscal profile', async () => {
    const user = await createTestUser('user');
    const other = await createTestUser('user');
    const token = createAccessToken(String(user._id), 'user');

    await FiscalProfile.create({
      userId: other._id,
      ...fiscalPayload,
    });

    const res = await request(app)
      .get('/account/fiscal-profile')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});
