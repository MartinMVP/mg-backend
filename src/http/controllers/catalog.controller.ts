import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Animal } from '../../domain/animals/animal.model';
import { Listing } from '../../domain/listings/listing.model';
import { Breed } from '../../domain/breeds/breed.model';
import { Registry } from '../../domain/registries/registry.model';
import { Audit } from '../../domain/audit/audit.model'; // ⬅️ ajusta si tu ruta difiere
import {
  consumeListingSlot,
  releaseListingSlot,
} from '../../domain/memberships/membershipCatalogPolicy';

// Helpers
function num(v: any, def: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function bool(v: any, def = false) {
  if (v === undefined) return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function pickAllowed(source: any, allowed: string[]) {
  const output: Record<string, unknown> = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(source || {}, key)) {
      output[key] = source[key];
    }
  }

  return output;
}

function consumesListingCapacity(status: string) {
  return ['published', 'auction_active', 'auction_closed'].includes(status);
}

// ---------- Animals ----------
export async function listAnimals(req: Request, res: Response) {
  const {
    q, breed, sex, state, minAge, maxAge, page = '1', limit = '20'
  } = req.query as Record<string, string>;

  const filter: any = { isActive: true, deletedAt: null };

  if (breed && Types.ObjectId.isValid(breed)) filter.breed = breed;
  if (sex) filter.sex = sex;
  if (state) filter['location.state'] = state;

  // texto
  if (q && q.trim()) {
    filter.$text = { $search: q.trim() };
  }

  // edad por birthDate (meses)
  const now = new Date();
  const minMonths = num(minAge, NaN);
  const maxMonths = num(maxAge, NaN);
  if (Number.isFinite(minMonths) || Number.isFinite(maxMonths)) {
    filter.birthDate = {};
    if (Number.isFinite(minMonths)) {
      const maxBirth = new Date(now);
      maxBirth.setMonth(now.getMonth() - minMonths);
      filter.birthDate.$lte = maxBirth;
    }
    if (Number.isFinite(maxMonths)) {
      const minBirth = new Date(now);
      minBirth.setMonth(now.getMonth() - maxMonths);
      filter.birthDate.$gte = minBirth;
    }
  }

  const pageNum = Math.max(1, num(page, 1));
  const perPage = Math.min(100, Math.max(1, num(limit, 20)));
  const skip = (pageNum - 1) * perPage;

  const [items, total] = await Promise.all([
    Animal.find(filter)
      .populate('breed registry')
      .skip(skip).limit(perPage)
      .sort({ createdAt: -1 }),
    Animal.countDocuments(filter),
  ]);

  res.json({ items, total, page: pageNum, pages: Math.ceil(total / perPage) });
}

export async function getAnimal(req: Request, res: Response) {
  const doc = await Animal.findById(req.params.id).populate('breed registry');
  if (!doc || doc.deletedAt) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
}

export async function createAnimal(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user?.sub) return res.status(401).json({ message: 'No autenticado' });

  const data = { ...req.body, owner: user.sub, deletedAt: null };
  const doc = await Animal.create(data);

  await Audit.create({
    actor: user.sub,
    action: 'animal.create',
    entity: 'Animal',
    entityId: doc._id,
    payload: data,
  });

  res.status(201).json(doc);
}

export async function updateAnimal(req: Request, res: Response) {
  const user = (req as any).user;
  const doc = await Animal.findById(req.params.id);
  if (!doc || doc.deletedAt) return res.status(404).json({ error: 'Not found' });

  const before = doc.toObject();
  const isOwner = String(doc.owner) === user.sub;
  const canEdit = isOwner || ['admin', 'super'].includes(user.role);
  if (!canEdit) return res.status(403).json({ error: 'Forbidden' });

  const updates = pickAllowed(req.body, [
    'name',
    'breed',
    'sex',
    'birthDate',
    'registry',
    'registryId',
    'pedigreeUrl',
    'weightKg',
    'location',
    'isActive',
  ]);

  Object.assign(doc, updates);
  await doc.save();

  await Audit.create({
    actor: user.sub,
    action: 'animal.update',
    entity: 'Animal',
    entityId: doc._id,
    payload: { before, after: doc },
  });

  res.json(doc);
}

export async function deleteAnimal(req: Request, res: Response) {
  const user = (req as any).user;
  const doc = await Animal.findById(req.params.id);
  if (!doc || doc.deletedAt) return res.status(404).json({ error: 'Not found' });

  const isOwner = String(doc.owner) === user.sub;
  const canDelete = isOwner || ['admin', 'super'].includes(user.role);
  if (!canDelete) return res.status(403).json({ error: 'Forbidden' });

  doc.deletedAt = new Date();
  await doc.save();

  await Audit.create({
    actor: user.sub,
    action: 'animal.delete',
    entity: 'Animal',
    entityId: doc._id,
  });

  res.json({ ok: true });
}

// ---------- Listings ----------
export async function listListings(req: Request, res: Response) {
  const { breed, sex, state, minPrice, maxPrice, page = '1', limit = '20', featured } =
    req.query as Record<string, string>;

  const filter: any = { status: 'published' };

  if (Number.isFinite(Number(minPrice)))
    filter.price = { ...(filter.price || {}), $gte: Number(minPrice) };
  if (Number.isFinite(Number(maxPrice)))
    filter.price = { ...(filter.price || {}), $lte: Number(maxPrice) };
  if (bool(featured, false)) filter.featured = true;

  const animalMatch: any = {};
  if (breed && Types.ObjectId.isValid(breed)) animalMatch.breed = breed;
  if (sex) animalMatch.sex = sex;
  if (state) animalMatch['location.state'] = state;

  const pageNum = Math.max(1, Number(page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (pageNum - 1) * perPage;

  const qFind = Listing.find(filter)
    .populate({ path: 'animal', match: animalMatch, populate: ['breed', 'registry'] })
    .populate('media') // ⬅️ trae objetos de media
    .skip(skip)
    .limit(perPage)
    .sort({ featured: -1, createdAt: -1 });

  const [itemsRaw, total] = await Promise.all([qFind, Listing.countDocuments(filter)]);
  const items = itemsRaw.filter((it) => it.animal); // descarta las que no cumplieron match

  res.json({ items, total, page: pageNum, pages: Math.ceil(total / perPage) });
}

export async function getListing(req: Request, res: Response) {
  const doc = await Listing.findById(req.params.id).populate({
    path: 'animal',
    populate: ['breed', 'registry'],
  }).populate('media');
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
}

export async function createListing(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user?.sub) return res.status(401).json({ message: 'No autenticado' });

  const animalId = req.body?.animal;
  if (!Types.ObjectId.isValid(String(animalId))) {
    return res.status(400).json({ error: 'Invalid animal id' });
  }

  const animal = await Animal.findById(animalId).select('owner deletedAt');
  if (!animal || animal.deletedAt) return res.status(404).json({ error: 'Animal not found' });

  const canUseAnimal = String(animal.owner) === user.sub || ['admin', 'super'].includes(user.role);
  if (!canUseAnimal) return res.status(403).json({ error: 'Forbidden' });

  const payload = { ...req.body, seller: user.sub, animal: animal._id };
  const requestedStatus = payload.status ?? 'published';
  const shouldConsumeCapacity = consumesListingCapacity(requestedStatus);
  const capacity = shouldConsumeCapacity ? await consumeListingSlot(user.sub) : null;
  if (capacity && !capacity.consumed) {
    return res.status(409).json({ error: 'membership_limit_reached', remaining: 0 });
  }

  let doc;
  try {
    doc = await Listing.create(payload);
  } catch (error) {
    if (capacity?.consumed) await releaseListingSlot(user.sub);
    throw error;
  }

  await Audit.create({
    actor: user.sub,
    action: 'listing.create',
    entity: 'Listing',
    entityId: doc._id,
    payload,
  });

  res.status(201).json(doc);
}

export async function updateListing(req: Request, res: Response) {
  const user = (req as any).user;
  const doc = await Listing.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const before = doc.toObject();
  const isOwner = String(doc.seller) === user.sub;
  const canEdit = isOwner || ['admin', 'super'].includes(user.role);
  if (!canEdit) return res.status(403).json({ error: 'Forbidden' });

  const updates = pickAllowed(req.body, [
    'price',
    'currency',
    'isNegotiable',
    'featured',
    'status',
    'media',
  ]);

  const beforeStatus = doc.status;
  const nextStatus = (updates.status as string | undefined) ?? beforeStatus;
  const shouldConsumeCapacity = !consumesListingCapacity(beforeStatus) && consumesListingCapacity(nextStatus);
  const shouldReleaseCapacity = consumesListingCapacity(beforeStatus) && ['sold', 'archived'].includes(nextStatus);
  const capacity = shouldConsumeCapacity ? await consumeListingSlot(doc.seller) : null;
  if (capacity && !capacity.consumed) {
    return res.status(409).json({ error: 'membership_limit_reached', remaining: 0 });
  }

  Object.assign(doc, updates);
  try {
    await doc.save();
  } catch (error) {
    if (capacity?.consumed) await releaseListingSlot(doc.seller);
    throw error;
  }

  if (shouldReleaseCapacity) {
    await releaseListingSlot(doc.seller);
  }

  await Audit.create({
    actor: user.sub,
    action: 'listing.update',
    entity: 'Listing',
    entityId: doc._id,
    payload: { before, after: doc },
  });

  res.json(doc);
}

export async function deleteListing(req: Request, res: Response) {
  const user = (req as any).user;
  const doc = await Listing.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const isOwner = String(doc.seller) === user.sub;
  const canDelete = isOwner || ['admin', 'super'].includes(user.role);
  if (!canDelete) return res.status(403).json({ error: 'Forbidden' });

  const shouldReleaseCapacity = consumesListingCapacity(doc.status);
  await doc.deleteOne();
  if (shouldReleaseCapacity) {
    await releaseListingSlot(doc.seller);
  }

  await Audit.create({
    actor: user.sub,
    action: 'listing.delete',
    entity: 'Listing',
    entityId: doc._id,
  });

  res.json({ ok: true });
}

// ---------- Catálogos maestros ----------
export async function listBreeds(_req: Request, res: Response) {
  const docs = await Breed.find({ isActive: true }).sort({ name: 1 });
  res.json(docs);
}

export async function listRegistries(_req: Request, res: Response) {
  const docs = await Registry.find({ isActive: true }).sort({ name: 1 });
  res.json(docs);
}

export async function createBreed(req: Request, res: Response) {
  const doc = await Breed.create({ name: req.body.name, code: req.body.code });
  res.status(201).json(doc);
}

export async function createRegistry(req: Request, res: Response) {
  const doc = await Registry.create({
    name: req.body.name,
    authority: req.body.authority,
    country: req.body.country,
  });
  res.status(201).json(doc);
}
