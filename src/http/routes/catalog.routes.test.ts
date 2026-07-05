import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { Animal } from '../../domain/animals/animal.model';
import { Breed } from '../../domain/breeds/breed.model';
import { Listing } from '../../domain/listings/listing.model';
import { Media } from '../../domain/media/media.model';
import { MediaReference } from '../../domain/media/mediaReference.model';
import { MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { MembershipUsage } from '../../domain/memberships/membershipUsage.model';
import { activateMembership, createMembership } from '../../domain/memberships/membershipFoundation.service';
import { Notification } from '../../domain/notifications/notification.model';
import { bearer } from '../../test/helpers/auth';
import { signAccessToken } from '../../utils/jwt';
import { createTestUser } from '../../test/helpers/factories';

function tokenFor(user: any, role: 'user' | 'admin' | 'super' = user.role || 'user') {
  return signAccessToken({ sub: String(user._id), role, typ: 'access' });
}

async function createBreed() {
  const suffix = new Types.ObjectId().toString();
  return Breed.create({ name: `Breed ${suffix}`, code: `B-${suffix.slice(-6)}` });
}

async function grantPublishingMembership(user: any, maxActiveListings = 2) {
  const suffix = new Types.ObjectId().toString();
  const plan = await MembershipPlan.create({
    code: `publisher-${suffix.slice(-6)}`,
    name: 'Publisher',
    monthlyPrice: 1000,
    yearlyPrice: 10000,
    durationDays: 30,
    price: 1000,
    currency: 'MXN',
    billingPeriod: 'manual',
    benefits: {
      maxActiveListings,
      maxPhotosPerListing: 20,
      canUseFeaturedListings: true,
      includedFeaturedListings: 3,
      canAccessAuctions: false,
      canAccessMetrics: false,
      supportLevel: 'basic',
    },
    limits: { animalListings: maxActiveListings, mediaUploads: 20, messaging: 10, featuredPublications: 3 },
    isActive: true,
  });
  const membership = await createMembership({ userId: String(user._id), planId: String(plan._id) }, String(user._id));
  await activateMembership(String(membership._id), String(user._id));
  return { plan, membership };
}

async function createAnimalViaApi(user: any, token: string) {
  const breed = await createBreed();
  const res = await request(app)
    .post('/catalog/animals')
    .set('Authorization', bearer(token))
    .send({
      tag: `TAG-${new Types.ObjectId().toString().slice(-8)}`,
      name: 'Toro Publicable',
      breed: String(breed._id),
      sex: 'M',
      birthDate: '2024-01-10T00:00:00.000Z',
      registryId: 'REG-13-3',
      weightKg: 450,
      location: { state: 'Sonora', municipality: 'Hermosillo' },
    })
    .expect(201);
  expect(String(res.body.owner)).toBe(String(user._id));
  return res.body;
}

async function uploadMedia(token: string, filename = 'animal.jpg', content = Buffer.from('fake-image')) {
  return request(app)
    .post('/media/upload')
    .set('Authorization', bearer(token))
    .attach('file', content, filename)
    .expect(201);
}

describe('Capability 13.3 Publicar Ganado', () => {
  it('allows the full E2E journey: animal, media references, draft listing, publish, marketplace visibility and archive', async () => {
    const user = await createTestUser('user');
    const admin = await createTestUser('admin');
    const token = tokenFor(user, 'user');
    await grantPublishingMembership(user, 2);

    const animal = await createAnimalViaApi(user, token);
    const updated = await request(app)
      .patch(`/catalog/animals/${animal._id}`)
      .set('Authorization', bearer(token))
      .send({ name: 'Toro Editado', weightKg: 475 })
      .expect(200);
    expect(updated.body.name).toBe('Toro Editado');

    const image = await uploadMedia(token, 'animal.jpg', Buffer.from('image-content'));
    const document = await uploadMedia(token, 'pedigree.pdf', Buffer.from('%PDF-1.4'));
    expect(image.body.kind).toBe('image');
    expect(document.body.kind).toBe('document');
    expect(await MediaReference.countDocuments({ ownerId: user._id })).toBe(2);

    const listing = await request(app)
      .post('/catalog/listings')
      .set('Authorization', bearer(token))
      .send({
        animalId: animal._id,
        title: 'Toro Angus listo para venta',
        description: 'Animal con registro y evidencia adjunta.',
        price: 25000,
        media: [image.body._id, document.body._id],
      })
      .expect(201);

    expect(listing.body.status).toBe('draft');
    expect(await MembershipUsage.findOne({ userId: user._id })).toMatchObject({ activeListingsCount: 0, listingsCreatedThisPeriod: 0 });

    const published = await request(app)
      .patch(`/catalog/listings/${listing.body._id}/publish`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(published.body.status).toBe('published');
    expect(published.body.publishedAt).toBeTruthy();

    const marketplace = await request(app).get(`/catalog/listings/${listing.body._id}`).expect(200);
    expect(marketplace.body.status).toBe('published');
    expect(marketplace.body.media).toHaveLength(2);

    const list = await request(app).get('/catalog/listings').expect(200);
    expect(list.body.items.some((item: any) => String(item._id) === String(listing.body._id))).toBe(true);

    const usageAfterPublish = await MembershipUsage.findOne({ userId: user._id }).lean();
    expect(usageAfterPublish?.activeListingsCount).toBe(1);
    expect(usageAfterPublish?.listingsCreatedThisPeriod).toBe(1);
    expect(await Notification.exists({ userId: user._id, type: 'listing_published' })).toBeTruthy();

    const archived = await request(app)
      .patch(`/catalog/listings/${listing.body._id}/archive`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(archived.body.status).toBe('archived');
    expect((await MembershipUsage.findOne({ userId: user._id }).lean())?.activeListingsCount).toBe(0);

    expect(await Audit.exists({ actor: String(user._id), action: 'ANIMAL_CREATED' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(user._id), action: 'ANIMAL_UPDATED' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(user._id), action: 'MEDIA_UPLOADED' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(user._id), action: 'LISTING_CREATED' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(user._id), action: 'LISTING_PUBLISHED' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(user._id), action: 'LISTING_ARCHIVED' })).toBeTruthy();

    const dashboard = await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .expect(200);
    expect(dashboard.body.marketplacePublishing.animalsCreated).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.marketplacePublishing.listingsPublished).toBeGreaterThanOrEqual(0);
    expect(dashboard.body.marketplacePublishing.mediaUploaded).toBeGreaterThanOrEqual(2);
    expect(dashboard.body.marketplacePublishing.membershipSlotsConsumed).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.marketplacePublishing.membershipSlotsReleased).toBeGreaterThanOrEqual(1);
  });

  it('does not validate membership before Publish and publish is idempotent', async () => {
    const user = await createTestUser('user');
    const token = tokenFor(user, 'user');
    const animal = await createAnimalViaApi(user, token);
    const media = await uploadMedia(token);

    const draft = await request(app)
      .post('/catalog/listings')
      .set('Authorization', bearer(token))
      .send({ animal: animal._id, title: 'Draft sin membresía', price: 12000, media: [media.body._id] })
      .expect(201);
    expect(draft.body.status).toBe('draft');
    expect(await MembershipUsage.findOne({ userId: user._id })).toBeNull();

    await request(app)
      .patch(`/catalog/listings/${draft.body._id}/publish`)
      .set('Authorization', bearer(token))
      .expect(200);
    await request(app)
      .patch(`/catalog/listings/${draft.body._id}/publish`)
      .set('Authorization', bearer(token))
      .expect(200);

    expect(await Listing.countDocuments({ _id: draft.body._id, status: 'published' })).toBe(1);
    const usage = await MembershipUsage.findOne({ userId: user._id }).lean();
    expect(usage?.activeListingsCount).toBe(1);
    expect(usage?.listingsCreatedThisPeriod).toBe(1);
  });

  it('enforces membership limits only at publish and releases capacity on archive idempotently', async () => {
    const user = await createTestUser('user');
    const token = tokenFor(user, 'user');
    await grantPublishingMembership(user, 1);
    const firstAnimal = await createAnimalViaApi(user, token);
    const secondAnimal = await createAnimalViaApi(user, token);

    const first = await request(app).post('/catalog/listings').set('Authorization', bearer(token)).send({ animal: firstAnimal._id, price: 1000 }).expect(201);
    const second = await request(app).post('/catalog/listings').set('Authorization', bearer(token)).send({ animal: secondAnimal._id, price: 1000 }).expect(201);

    await request(app).patch(`/catalog/listings/${first.body._id}/publish`).set('Authorization', bearer(token)).expect(200);
    const blocked = await request(app).patch(`/catalog/listings/${second.body._id}/publish`).set('Authorization', bearer(token)).expect(409);
    expect(blocked.body.error).toBe('membership_limit_reached');

    await request(app).patch(`/catalog/listings/${first.body._id}/archive`).set('Authorization', bearer(token)).expect(200);
    await request(app).patch(`/catalog/listings/${first.body._id}/archive`).set('Authorization', bearer(token)).expect(200);
    expect((await MembershipUsage.findOne({ userId: user._id }).lean())?.activeListingsCount).toBe(0);

    await request(app).patch(`/catalog/listings/${second.body._id}/publish`).set('Authorization', bearer(token)).expect(200);
    expect((await MembershipUsage.findOne({ userId: user._id }).lean())?.activeListingsCount).toBe(1);
  });

  it('enforces media ownership and basic moderation states without automatic moderation or scoring', async () => {
    const owner = await createTestUser('user');
    const other = await createTestUser('user');
    const ownerToken = tokenFor(owner, 'user');
    const otherToken = tokenFor(other, 'user');
    await grantPublishingMembership(owner, 2);

    const animal = await createAnimalViaApi(owner, ownerToken);
    const otherMedia = await uploadMedia(otherToken);

    const blocked = await request(app)
      .post('/catalog/listings')
      .set('Authorization', bearer(ownerToken))
      .send({ animal: animal._id, price: 1000, media: [otherMedia.body._id] })
      .expect(403);
    expect(blocked.body.error).toBe('media_not_owned');

    const rejected = await Listing.create({ animal: animal._id, seller: owner._id, price: 1500, status: 'rejected' });
    await request(app).patch(`/catalog/listings/${rejected._id}/publish`).set('Authorization', bearer(ownerToken)).expect(200);
    expect((await Listing.findById(rejected._id).lean())?.status).toBe('published');

    const archived = await Listing.create({ animal: animal._id, seller: owner._id, price: 1500, status: 'archived' });
    const cannotPublish = await request(app).patch(`/catalog/listings/${archived._id}/publish`).set('Authorization', bearer(ownerToken)).expect(409);
    expect(cannotPublish.body.error).toBe('listing_cannot_publish');
  });

  it('keeps Membership, Media, Revenue, Fiscal, AOE and Knowledge surfaces compatible', async () => {
    const user = await createTestUser('user');
    const admin = await createTestUser('admin');
    const token = tokenFor(user, 'user');
    await grantPublishingMembership(user, 1);
    const animal = await createAnimalViaApi(user, token);
    const listing = await request(app).post('/catalog/listings').set('Authorization', bearer(token)).send({ animal: animal._id, price: 1000 }).expect(201);
    await request(app).patch(`/catalog/listings/${listing.body._id}/publish`).set('Authorization', bearer(token)).expect(200);

    await request(app).get('/account/membership').set('Authorization', bearer(token)).expect(200);
    expect(await Media.countDocuments()).toBeGreaterThanOrEqual(0);
    await request(app).get('/admin/payments/records').set('Authorization', bearer(tokenFor(admin, 'admin'))).expect(200);
    await request(app).get('/admin/fiscal/transactions').set('Authorization', bearer(tokenFor(admin, 'admin'))).expect(200);

    const dashboard = await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .expect(200);
    expect(dashboard.body.aoe).toBeDefined();
    expect(dashboard.body.knowledgeFoundation).toBeDefined();
    expect(dashboard.body.marketplacePublishing).toBeDefined();
  });
});



