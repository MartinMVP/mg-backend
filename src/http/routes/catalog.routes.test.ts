import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Animal } from '../../domain/animals/animal.model';
import { Breed } from '../../domain/breeds/breed.model';
import { Listing } from '../../domain/listings/listing.model';
import { MembershipUsage } from '../../domain/memberships/membershipUsage.model';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createTestUser } from '../../test/helpers/factories';

describe('catalog marketplace security', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  async function createAnimalFor(ownerId: Types.ObjectId) {
    const suffix = new Types.ObjectId().toString();
    const breed = await Breed.create({ name: `Breed ${suffix}`, code: `B-${suffix.slice(-6)}` });

    return Animal.create({
      owner: ownerId,
      tag: `TAG-${suffix.slice(-8)}`,
      breed: breed._id,
      sex: 'M',
      location: { state: 'Sonora' },
    });
  }

  async function createListingFor(sellerId: Types.ObjectId) {
    const animal = await createAnimalFor(sellerId);

    return Listing.create({
      animal: animal._id,
      seller: sellerId,
      price: 1000,
    });
  }

  async function getUsageFor(userId: Types.ObjectId) {
    return MembershipUsage.findOne({ userId });
  }

  it('allows a user to create a listing for their own animal', async () => {
    const user = await createTestUser('user');
    const animal = await createAnimalFor(user._id);
    const token = createAccessToken(user._id, 'user');

    const res = await request(app)
      .post('/catalog/listings')
      .set('Authorization', bearer(token))
      .send({
        animal: String(animal._id),
        price: 1500,
        currency: 'MXN',
      });

    expect(res.status).toBe(201);
    expect(String(res.body.animal)).toBe(String(animal._id));
    expect(String(res.body.seller)).toBe(String(user._id));
  });

  it('published listing creation consumes membership capacity', async () => {
    const user = await createTestUser('user');
    const animal = await createAnimalFor(user._id);
    const token = createAccessToken(user._id, 'user');

    const res = await request(app)
      .post('/catalog/listings')
      .set('Authorization', bearer(token))
      .send({
        animal: String(animal._id),
        price: 1500,
      });
    const usage = await getUsageFor(user._id);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('published');
    expect(usage?.activeListingsCount).toBe(1);
    expect(usage?.listingsCreatedThisPeriod).toBe(1);
  });

  it('blocks published listing creation when membership capacity is exhausted', async () => {
    const user = await createTestUser('user');
    const firstAnimal = await createAnimalFor(user._id);
    const secondAnimal = await createAnimalFor(user._id);
    const token = createAccessToken(user._id, 'user');

    await request(app)
      .post('/catalog/listings')
      .set('Authorization', bearer(token))
      .send({
        animal: String(firstAnimal._id),
        price: 1500,
      })
      .expect(201);

    const blocked = await request(app)
      .post('/catalog/listings')
      .set('Authorization', bearer(token))
      .send({
        animal: String(secondAnimal._id),
        price: 1600,
      });

    expect(blocked.status).toBe(409);
    expect(blocked.body).toEqual({ error: 'membership_limit_reached', remaining: 0 });
    expect(await Listing.countDocuments({ seller: user._id })).toBe(1);
  });

  it('draft listing does not consume capacity until it is published', async () => {
    const user = await createTestUser('user');
    const animal = await createAnimalFor(user._id);
    const token = createAccessToken(user._id, 'user');

    const draft = await request(app)
      .post('/catalog/listings')
      .set('Authorization', bearer(token))
      .send({
        animal: String(animal._id),
        price: 1500,
        status: 'draft',
      })
      .expect(201);

    expect(await getUsageFor(user._id)).toBeNull();

    await request(app)
      .patch(`/catalog/listings/${draft.body._id}`)
      .set('Authorization', bearer(token))
      .send({ status: 'published' })
      .expect(200);

    const usage = await getUsageFor(user._id);
    expect(usage?.activeListingsCount).toBe(1);
    expect(usage?.listingsCreatedThisPeriod).toBe(1);
  });

  it('sold listing releases membership capacity and duplicate sold does not go negative', async () => {
    const user = await createTestUser('user');
    const animal = await createAnimalFor(user._id);
    const token = createAccessToken(user._id, 'user');
    const listing = await request(app)
      .post('/catalog/listings')
      .set('Authorization', bearer(token))
      .send({
        animal: String(animal._id),
        price: 1500,
      })
      .expect(201);

    await request(app)
      .patch(`/catalog/listings/${listing.body._id}`)
      .set('Authorization', bearer(token))
      .send({ status: 'sold' })
      .expect(200);
    await request(app)
      .patch(`/catalog/listings/${listing.body._id}`)
      .set('Authorization', bearer(token))
      .send({ status: 'sold' })
      .expect(200);

    const usage = await getUsageFor(user._id);
    expect(usage?.activeListingsCount).toBe(0);
    expect(usage?.listingsCreatedThisPeriod).toBe(1);
  });

  it('archived listing releases membership capacity', async () => {
    const user = await createTestUser('user');
    const animal = await createAnimalFor(user._id);
    const token = createAccessToken(user._id, 'user');
    const listing = await request(app)
      .post('/catalog/listings')
      .set('Authorization', bearer(token))
      .send({
        animal: String(animal._id),
        price: 1500,
      })
      .expect(201);

    await request(app)
      .patch(`/catalog/listings/${listing.body._id}`)
      .set('Authorization', bearer(token))
      .send({ status: 'archived' })
      .expect(200);

    const usage = await getUsageFor(user._id);
    expect(usage?.activeListingsCount).toBe(0);
    expect(usage?.listingsCreatedThisPeriod).toBe(1);
  });

  it('deleted listing releases membership capacity', async () => {
    const user = await createTestUser('user');
    const animal = await createAnimalFor(user._id);
    const token = createAccessToken(user._id, 'user');
    const listing = await request(app)
      .post('/catalog/listings')
      .set('Authorization', bearer(token))
      .send({
        animal: String(animal._id),
        price: 1500,
      })
      .expect(201);

    await request(app)
      .delete(`/catalog/listings/${listing.body._id}`)
      .set('Authorization', bearer(token))
      .expect(200);

    const usage = await getUsageFor(user._id);
    expect(usage?.activeListingsCount).toBe(0);
    expect(usage?.listingsCreatedThisPeriod).toBe(1);
  });

  it('suspended membership keeps existing listing but blocks new published listings', async () => {
    const user = await createTestUser('user');
    const firstAnimal = await createAnimalFor(user._id);
    const secondAnimal = await createAnimalFor(user._id);
    const token = createAccessToken(user._id, 'user');

    await request(app)
      .post('/catalog/listings')
      .set('Authorization', bearer(token))
      .send({
        animal: String(firstAnimal._id),
        price: 1500,
      })
      .expect(201);

    await UserMembership.findOneAndUpdate({ userId: user._id }, { $set: { status: 'suspended' } });

    const blocked = await request(app)
      .post('/catalog/listings')
      .set('Authorization', bearer(token))
      .send({
        animal: String(secondAnimal._id),
        price: 1600,
      });

    expect(blocked.status).toBe(409);
    expect(await Listing.countDocuments({ seller: user._id, status: 'published' })).toBe(1);
  });

  it('rejects creating a listing for another user animal', async () => {
    const owner = await createTestUser('user');
    const other = await createTestUser('user');
    const animal = await createAnimalFor(owner._id);
    const token = createAccessToken(other._id, 'user');

    const res = await request(app)
      .post('/catalog/listings')
      .set('Authorization', bearer(token))
      .send({
        animal: String(animal._id),
        price: 1500,
      });

    expect(res.status).toBe(403);
    expect(await Listing.countDocuments()).toBe(0);
  });

  it.each(['admin', 'super'] as const)('allows %s to create a listing for another user animal', async (role) => {
    const owner = await createTestUser('user');
    const manager = await createTestUser(role);
    const animal = await createAnimalFor(owner._id);
    const token = createAccessToken(manager._id, role);

    const res = await request(app)
      .post('/catalog/listings')
      .set('Authorization', bearer(token))
      .send({
        animal: String(animal._id),
        price: 1500,
      });

    expect(res.status).toBe(201);
    expect(String(res.body.animal)).toBe(String(animal._id));
    expect(String(res.body.seller)).toBe(String(manager._id));
  });

  it('allows an owner to update permitted animal fields', async () => {
    const user = await createTestUser('user');
    const animal = await createAnimalFor(user._id);
    const token = createAccessToken(user._id, 'user');

    const res = await request(app)
      .patch(`/catalog/animals/${animal._id}`)
      .set('Authorization', bearer(token))
      .send({
        name: 'Toro Actualizado',
        weightKg: 420,
      });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Toro Actualizado');
    expect(res.body.weightKg).toBe(420);
  });

  it('does not allow an animal owner to change owner', async () => {
    const user = await createTestUser('user');
    const other = await createTestUser('user');
    const animal = await createAnimalFor(user._id);
    const token = createAccessToken(user._id, 'user');

    const res = await request(app)
      .patch(`/catalog/animals/${animal._id}`)
      .set('Authorization', bearer(token))
      .send({
        owner: String(other._id),
        name: 'Nombre permitido',
      });
    const fresh = await Animal.findById(animal._id);

    expect(res.status).toBe(200);
    expect(String(fresh?.owner)).toBe(String(user._id));
    expect(fresh?.name).toBe('Nombre permitido');
  });

  it('does not allow an animal owner to change _id', async () => {
    const user = await createTestUser('user');
    const animal = await createAnimalFor(user._id);
    const token = createAccessToken(user._id, 'user');
    const attemptedId = new Types.ObjectId();

    const res = await request(app)
      .patch(`/catalog/animals/${animal._id}`)
      .set('Authorization', bearer(token))
      .send({
        _id: String(attemptedId),
        name: 'Id protegido',
      });
    const fresh = await Animal.findById(animal._id);

    expect(res.status).toBe(200);
    expect(fresh).toBeTruthy();
    expect(String(fresh?._id)).toBe(String(animal._id));
    expect(fresh?.name).toBe('Id protegido');
    expect(await Animal.findById(attemptedId)).toBeNull();
  });

  it('allows a seller to update permitted listing fields', async () => {
    const seller = await createTestUser('user');
    const listing = await createListingFor(seller._id);
    const token = createAccessToken(seller._id, 'user');

    const res = await request(app)
      .patch(`/catalog/listings/${listing._id}`)
      .set('Authorization', bearer(token))
      .send({
        price: 2500,
        isNegotiable: false,
      });

    expect(res.status).toBe(200);
    expect(res.body.price).toBe(2500);
    expect(res.body.isNegotiable).toBe(false);
  });

  it('does not allow a seller to change listing seller', async () => {
    const seller = await createTestUser('user');
    const other = await createTestUser('user');
    const listing = await createListingFor(seller._id);
    const token = createAccessToken(seller._id, 'user');

    const res = await request(app)
      .patch(`/catalog/listings/${listing._id}`)
      .set('Authorization', bearer(token))
      .send({
        seller: String(other._id),
        price: 2600,
      });
    const fresh = await Listing.findById(listing._id);

    expect(res.status).toBe(200);
    expect(String(fresh?.seller)).toBe(String(seller._id));
    expect(fresh?.price).toBe(2600);
  });

  it('does not allow a seller to change listing animal', async () => {
    const seller = await createTestUser('user');
    const listing = await createListingFor(seller._id);
    const otherAnimal = await createAnimalFor(seller._id);
    const token = createAccessToken(seller._id, 'user');

    const res = await request(app)
      .patch(`/catalog/listings/${listing._id}`)
      .set('Authorization', bearer(token))
      .send({
        animal: String(otherAnimal._id),
        price: 2700,
      });
    const fresh = await Listing.findById(listing._id);

    expect(res.status).toBe(200);
    expect(String(fresh?.animal)).toBe(String(listing.animal));
    expect(fresh?.price).toBe(2700);
  });
});
