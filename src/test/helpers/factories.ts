import { Types } from 'mongoose';
import { User } from '../../domain/users/user.model';
import { Breed } from '../../domain/breeds/breed.model';
import { Registry } from '../../domain/registries/registry.model';
import { Animal } from '../../domain/animals/animal.model';
import { Listing } from '../../domain/listings/listing.model';
import { Auction } from '../../domain/auctions/auction.model';

type Role = 'user' | 'admin' | 'super';

export async function createTestUser(role: Role = 'user') {
  const suffix = new Types.ObjectId().toString();

  return User.create({
    name: `Test ${role}`,
    email: `${role}-${suffix}@mg.test`,
    password: 'P4ssw0rd!',
    role,
  });
}

export async function createTestListing(ownerId?: Types.ObjectId) {
  const owner = ownerId || (await createTestUser())._id;
  const suffix = new Types.ObjectId().toString();

  const breed = await Breed.create({ name: `Breed ${suffix}`, code: `B-${suffix.slice(-6)}` });
  const registry = await Registry.create({
    name: `Registry ${suffix}`,
    authority: 'Test Authority',
    country: 'MX',
  });
  const animal = await Animal.create({
    owner,
    tag: `TAG-${suffix.slice(-8)}`,
    breed: breed._id,
    registry: registry._id,
    sex: 'M',
    location: { state: 'Sonora' },
  });

  return Listing.create({
    animal: animal._id,
    seller: owner,
    price: 1000,
  });
}

export async function createLiveAuction(overrides: Record<string, unknown> = {}) {
  const listing = await createTestListing();
  const now = Date.now();

  return Auction.create({
    title: 'Test auction',
    listing: listing._id,
    state: 'live',
    startsAt: new Date(now - 60_000),
    endsAt: new Date(now + 60_000),
    startPrice: 1000,
    minIncrement: 100,
    currentPrice: 1000,
    ...overrides,
  });
}
