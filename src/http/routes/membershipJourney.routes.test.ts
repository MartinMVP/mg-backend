import request from 'supertest';
import { describe, it, expect } from 'vitest';
import app from '../../app';
import { MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { UserMembership, membershipStatuses } from '../../domain/memberships/userMembership.model';
import { ensureFreeMembershipForUser } from '../../domain/memberships/membership.service';
import { Animal } from '../../domain/animals/animal.model';
import { Listing } from '../../domain/listings/listing.model';
import { Breed } from '../../domain/breeds/breed.model';
import { Media } from '../../domain/media/media.model';
import { PaymentRecord } from '../../domain/payments/paymentRecord.model';
import { createTestUser } from '../../test/helpers/factories';
import { signAccessToken } from '../../utils/jwt';

async function fixture(role: 'user' | 'admin' | 'super' = 'user') {
  const user = await createTestUser(role);
  const auth = `Bearer ${signAccessToken({ sub: String(user._id), role, typ: 'access' })}`;
  const { membership, plan } = await ensureFreeMembershipForUser(user._id);
  return { user, auth, membership, plan: plan! };
}

describe('CJ-02 membership journey contracts', () => {
  it('publishes only active public commercial plans without provider identifiers', async () => {
    const { plan } = await fixture();
    plan.price = 213.45; plan.benefits.maxActiveListings = 7; plan.stripePriceId = 'private-price'; await plan.save();
    const { body } = await request(app).get('/membership/plans').expect(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ price: 213.45, benefits: { maxActiveListings: 7 } });
    expect(body.items[0]).not.toHaveProperty('stripePriceId');
    expect(body.capabilities).toMatchObject({ paidCheckout: false, automaticRenewal: false, taxes: null });
    plan.isActive = false; await plan.save();
    expect((await request(app).get('/membership/plans')).body.items).toEqual([]);
  });

  it('isolates foreign drafts and prevents cross-user mutation of drafts and publications', async () => {
    const owner = await fixture(), other = await fixture();
    const breed = await Breed.create({ name: 'Private', code: 'private' });
    const animal = await Animal.create({ owner: owner.user._id, tag: 'private', breed: breed._id, sex: 'M', location: { state: 'Sonora' } });
    const draft = await Listing.create({ seller: owner.user._id, animal: animal._id, title: 'Private draft', price: 1, status: 'draft' });
    const catalog = (await request(app).get('/account/membership/catalog').set('Authorization', other.auth).expect(200)).body;
    expect(catalog.listings).toEqual([]);
    await request(app).get('/catalog/listings/' + draft._id).set('Authorization', other.auth).expect(404);
    for (const status of ['draft', 'published']) {
      draft.status = status as typeof draft.status; await draft.save();
      await request(app).patch('/catalog/listings/' + draft._id).set('Authorization', other.auth).send({ title: 'Changed' }).expect(403);
      await request(app).patch('/catalog/listings/' + draft._id + '/publish').set('Authorization', other.auth).expect(403);
      await request(app).patch('/catalog/listings/' + draft._id + '/archive').set('Authorization', other.auth).expect(403);
      await request(app).delete('/catalog/listings/' + draft._id).set('Authorization', other.auth).expect(403);
    }
    expect((await Listing.findById(draft._id))?.title).toBe('Private draft');
  });

  it('recommends from current benefits and validates inputs', async () => {
    const { plan } = await fixture();
    plan.benefits.maxActiveListings = 4; await plan.save();
    const url = '/membership/journey/recommend';
    expect((await request(app).post(url).send({ listings: 4, photos: 3, prioritySupport: false }).expect(200)).body.items).toHaveLength(1);
    expect((await request(app).post(url).send({ listings: 5, photos: 3, prioritySupport: false }).expect(200)).body.items).toHaveLength(0);
    expect((await request(app).post(url).send({ listings: 1, photos: 1, prioritySupport: true }).expect(200)).body.items).toHaveLength(0);
    await request(app).post(url).send({ listings: -1, photos: 1, prioritySupport: false }).expect(400);
  });

  it.each(['/account/membership/journey', '/account/membership/catalog', '/account/membership/journey/change-preview?plan=free'])('requires auth for %s', async url => {
    await request(app).get(url).expect(401);
    await request(app).get(url).set('Authorization', 'Bearer expired-token').expect(401);
  });

  it.each(['user', 'admin', 'super'] as const)('supports a producer account with role %s without exposing other owners', async role => {
    const a = await fixture(role), b = await fixture();
    const breed = await Breed.create({ name: 'Test', code: 'test' });
    await Animal.create({ owner: b.user._id, tag: 'private', breed: breed._id, sex: 'M', location: { state: 'Sonora' } });
    await PaymentRecord.create({ userId: b.user._id, status: 'succeeded', amount: 999, currency: 'MXN', provider: 'stripe', providerEnvironment: 'sandbox' });
    const { body } = await request(app).get(`/account/membership/catalog?userId=${b.user._id}`).set('Authorization', a.auth).expect(200);
    expect(body.animals).toEqual([]);
    const snapshot = (await request(app).get('/account/membership/journey').set('Authorization', a.auth).expect(200)).body;
    expect(snapshot.payments).toEqual([]);
    expect(snapshot.membership._id).toBe(String(a.membership._id));
    expect(snapshot.membership).not.toHaveProperty('providerCustomerId');
  });

  it.each(membershipStatuses)('reports %s truthfully with policy-owned capacity', async status => {
    const { auth, membership } = await fixture();
    membership.status = status; await membership.save();
    const { body } = await request(app).get('/account/membership/journey').set('Authorization', auth).expect(200);
    const grants = ['active', 'grace_period', 'in_dunning'].includes(status);
    expect(body.membership.status).toBe(status);
    expect(body.capacity.grantsBenefits).toBe(grants);
    expect(body.actions.publish).toBe(grants);
    expect(body.capacity.remaining).toBe(grants ? 1 : 0);
    expect(body.actions.withdrawCancellation).toBe(false);
  });

  it('keeps a pending paid request separate from an already active free membership', async () => {
    const { auth, user } = await fixture();
    const pro = await MembershipPlan.findOne({ code: 'pro' });
    await UserMembership.create({ userId: user._id, planId: pro!._id, status: 'pending_payment', startsAt: new Date(), currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 86400000), source: 'manual' });
    const { body } = await request(app).get('/account/membership/journey').set('Authorization', auth).expect(200);
    expect(body.plan.code).toBe('free'); expect(body.pendingMembership.status).toBe('pending_payment');
  });

  it('previews change without mutating; blocks unavailable paid upgrade and private plans', async () => {
    const { auth, membership } = await fixture();
    await request(app).get('/account/membership/journey/change-preview?plan=pro').set('Authorization', auth).expect(404);
    await MembershipPlan.updateOne({ code: 'pro' }, { $set: { isPublic: true, price: 100 } });
    const { body } = await request(app).get('/account/membership/journey/change-preview?plan=pro').set('Authorization', auth).expect(200);
    expect(body).toMatchObject({ allowed: false, requiresCheckout: true, effectiveAt: null });
    expect((await UserMembership.findById(membership._id))?.pendingPlanId).toBeUndefined();
  });

  it('reports cancellation scheduling and withdrawal without claiming a new activation', async () => {
    const { auth } = await fixture();
    const result = await request(app).post('/account/membership/cancel').set('Authorization', auth).send({}).expect(200);
    expect(result.body.scheduled).toBe(true);
    let j = (await request(app).get('/account/membership/journey').set('Authorization', auth)).body;
    expect(j.actions).toMatchObject({ cancel: false, withdrawCancellation: true });
    await request(app).post('/account/membership/reactivate').set('Authorization', auth).send({}).expect(200);
    j = (await request(app).get('/account/membership/journey').set('Authorization', auth)).body;
    expect(j.membership.cancelAtPeriodEnd).toBe(false);
  });

  it('reaches first business value only on publication and releases capacity on archive/delete', async () => {
    const { user, auth } = await fixture();
    const breed = await Breed.create({ name: 'Test', code: 'test' });
    const animal = (await request(app).post('/catalog/animals').set('Authorization', auth).send({ tag: 'CJ-02', name: 'Ejemplar', breed: String(breed._id), sex: 'M', location: { state: 'Sonora' } }).expect(201)).body;
    const media = await Media.create({ owner: user._id, kind: 'document', url: '/files/test.pdf' });
    const listing = (await request(app).post('/catalog/listings').set('Authorization', auth).send({ animalId: animal._id, title: 'Ejemplar CJ-02', price: 5000, media: [String(media._id)] }).expect(201)).body;
    const snapshot = async () => (await request(app).get('/account/membership/journey').set('Authorization', auth).expect(200)).body;
    expect((await snapshot()).capacity.activeListings).toBe(0);
    await request(app).patch(`/catalog/listings/${listing._id}/publish`).set('Authorization', auth).expect(200);
    const active = await snapshot();
    expect(active.capacity).toMatchObject({ activeListings: 1, remaining: 0 });
    expect(active.usage.listingsCreatedThisPeriod).toBe(1); expect(active.actions.publish).toBe(false);
    await request(app).patch(`/catalog/listings/${listing._id}/publish`).set('Authorization', auth).expect(200);
    expect((await snapshot()).usage.listingsCreatedThisPeriod).toBe(1);
    const second = await Listing.create({ seller: user._id, animal: animal._id, price: 1, status: 'draft' });
    await request(app).patch(`/catalog/listings/${second._id}/publish`).set('Authorization', auth).expect(409);
    await request(app).patch(`/catalog/listings/${listing._id}/archive`).set('Authorization', auth).expect(200);
    expect((await snapshot()).capacity.remaining).toBe(1);
    await request(app).patch(`/catalog/listings/${second._id}/publish`).set('Authorization', auth).expect(200);
    await request(app).delete(`/catalog/listings/${second._id}`).set('Authorization', auth).expect(200);
    expect((await snapshot()).capacity.activeListings).toBe(0);
  });

  it('enforces dynamic photo benefits without counting documents as photos or slots', async () => {
    const { user, auth, plan } = await fixture();
    plan.benefits.maxPhotosPerListing = 1; await plan.save();
    const breed = await Breed.create({ name: 'Test', code: 'test' });
    const animal = await Animal.create({ owner: user._id, tag: 'photo', breed: breed._id, sex: 'M', location: { state: 'Sonora' } });
    const photo1 = await Media.create({ owner: user._id, kind: 'image', url: '/files/1.jpg' });
    const photo2 = await Media.create({ owner: user._id, kind: 'image', url: '/files/2.jpg' });
    const doc = await Media.create({ owner: user._id, kind: 'document', url: '/files/doc.pdf' });
    const payload = { animalId: String(animal._id), price: 0, media: [String(photo1._id), String(photo2._id)] };
    await request(app).post('/catalog/listings').set('Authorization', auth).send(payload).expect(409);
    const saved = (await request(app).post('/catalog/listings').set('Authorization', auth).send({ ...payload, media: [String(photo1._id), String(doc._id)] }).expect(201)).body;
    await request(app).patch(`/catalog/listings/${saved._id}`).set('Authorization', auth).send({ media: payload.media }).expect(409);
    plan.benefits.maxPhotosPerListing = 0; await plan.save();
    await request(app).patch(`/catalog/listings/${saved._id}/publish`).set('Authorization', auth).expect(409);
  });
});
