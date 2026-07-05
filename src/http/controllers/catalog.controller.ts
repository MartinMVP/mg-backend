import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Animal } from '../../domain/animals/animal.model';
import { Listing } from '../../domain/listings/listing.model';
import { Media } from '../../domain/media/media.model';
import { Breed } from '../../domain/breeds/breed.model';
import { Registry } from '../../domain/registries/registry.model';
import { Audit } from '../../domain/audit/audit.model';
import { Notification } from '../../domain/notifications/notification.model';
import { consumeListingSlot, releaseListingSlot } from '../../domain/memberships/membershipCatalogPolicy';

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
    if (Object.prototype.hasOwnProperty.call(source || {}, key)) output[key] = source[key];
  }
  return output;
}

function consumesListingCapacity(status: string) {
  return ['published', 'auction_active', 'auction_closed'].includes(status);
}

function mediaIdsFromBody(body: any) {
  const raw = Array.isArray(body?.media) ? body.media : [];
  return raw.map((item: any) => String(item?.mediaId || item?._id || item)).filter(Boolean);
}

async function validateOwnedMedia(mediaIds: string[], ownerId: string) {
  if (!mediaIds.length) return { ok: true, ids: [] as Types.ObjectId[] };
  if (mediaIds.some((id) => !Types.ObjectId.isValid(id))) return { ok: false, reason: 'invalid_media_id', ids: [] as Types.ObjectId[] };
  const ids = mediaIds.map((id) => new Types.ObjectId(id));
  const count = await Media.countDocuments({ _id: { $in: ids }, owner: ownerId });
  if (count !== ids.length) return { ok: false, reason: 'media_not_owned', ids: [] as Types.ObjectId[] };
  return { ok: true, ids };
}

async function audit(actor: string, action: string, entity: string, entityId: Types.ObjectId, payload?: Record<string, unknown>) {
  await Audit.create({ actor, action, entity, entityId, payload } as any);
}

// ---------- Animals ----------
export async function listAnimals(req: Request, res: Response) {
  const { q, breed, sex, state, minAge, maxAge, page = '1', limit = '20' } = req.query as Record<string, string>;
  const filter: any = { isActive: true, deletedAt: null };

  if (breed && Types.ObjectId.isValid(breed)) filter.breed = breed;
  if (sex) filter.sex = sex;
  if (state) filter['location.state'] = state;
  if (q && q.trim()) filter.$text = { $search: q.trim() };

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
    Animal.find(filter).populate('breed registry').skip(skip).limit(perPage).sort({ createdAt: -1 }),
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

  const data = { ...req.body, owner: user.sub, deletedAt: null, status: req.body?.status || 'active' };
  const doc = await Animal.create(data);
  await audit(user.sub, 'ANIMAL_CREATED', 'Animal', doc._id, { tag: doc.tag });
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

  const updates = pickAllowed(req.body, ['name', 'breed', 'sex', 'birthDate', 'registry', 'registryId', 'pedigreeUrl', 'weightKg', 'location', 'isActive', 'status']);
  Object.assign(doc, updates);
  await doc.save();

  await audit(user.sub, 'ANIMAL_UPDATED', 'Animal', doc._id, { before, after: doc.toObject() });
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
  await audit(user.sub, 'ANIMAL_DELETED', 'Animal', doc._id);
  res.json({ ok: true });
}

// ---------- Listings ----------
export async function listListings(req: Request, res: Response) {
  const { breed, sex, state, minPrice, maxPrice, page = '1', limit = '20', featured } = req.query as Record<string, string>;
  const filter: any = { status: 'published' };

  if (Number.isFinite(Number(minPrice))) filter.price = { ...(filter.price || {}), $gte: Number(minPrice) };
  if (Number.isFinite(Number(maxPrice))) filter.price = { ...(filter.price || {}), $lte: Number(maxPrice) };
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
    .populate('media')
    .skip(skip)
    .limit(perPage)
    .sort({ featured: -1, publishedAt: -1, createdAt: -1 });

  const [itemsRaw, total] = await Promise.all([qFind, Listing.countDocuments(filter)]);
  const items = itemsRaw.filter((it) => it.animal);
  res.json({ items, total, page: pageNum, pages: Math.ceil(total / perPage) });
}

export async function getListing(req: Request, res: Response) {
  const doc = await Listing.findById(req.params.id)
    .populate({ path: 'animal', populate: ['breed', 'registry'] })
    .populate('media');
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
}

export async function createListing(req: Request, res: Response) {
  const user = (req as any).user;
  if (!user?.sub) return res.status(401).json({ message: 'No autenticado' });

  const animalId = req.body?.animalId ?? req.body?.animal;
  if (!Types.ObjectId.isValid(String(animalId))) return res.status(400).json({ error: 'Invalid animal id' });

  const animal = await Animal.findById(animalId).select('owner deletedAt');
  if (!animal || animal.deletedAt) return res.status(404).json({ error: 'Animal not found' });

  const canUseAnimal = String(animal.owner) === user.sub || ['admin', 'super'].includes(user.role);
  if (!canUseAnimal) return res.status(403).json({ error: 'Forbidden' });

  const media = await validateOwnedMedia(mediaIdsFromBody(req.body), user.sub);
  if (!media.ok) return res.status(403).json({ error: media.reason });

  const payload = {
    animal: animal._id,
    seller: user.sub,
    title: req.body?.title,
    description: req.body?.description,
    price: Number(req.body?.price ?? 0),
    currency: 'MXN' as const,
    isNegotiable: req.body?.isNegotiable ?? true,
    featured: Boolean(req.body?.featured ?? false),
    media: media.ids,
    status: 'draft' as const,
  };
  const doc = await Listing.create(payload);
  await audit(user.sub, 'LISTING_CREATED', 'Listing', doc._id, { animalId: String(animal._id), mediaCount: media.ids.length });
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

  const updates = pickAllowed(req.body, ['title', 'description', 'price', 'currency', 'isNegotiable', 'featured', 'media']);
  if (updates.media) {
    const media = await validateOwnedMedia(mediaIdsFromBody(updates), user.sub);
    if (!media.ok) return res.status(403).json({ error: media.reason });
    updates.media = media.ids;
  }

  Object.assign(doc, updates);
  await doc.save();
  await audit(user.sub, 'LISTING_UPDATED', 'Listing', doc._id, { before, after: doc.toObject() });
  res.json(doc);
}

export async function publishListing(req: Request, res: Response) {
  const user = (req as any).user;
  const doc = await Listing.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const isOwner = String(doc.seller) === user.sub;
  const canPublish = isOwner || ['admin', 'super'].includes(user.role);
  if (!canPublish) return res.status(403).json({ error: 'Forbidden' });
  if (doc.status === 'published') return res.json(doc);
  if (!['draft', 'pending_review', 'rejected'].includes(doc.status)) return res.status(409).json({ error: 'listing_cannot_publish' });

  const animal = await Animal.findById(doc.animal).select('deletedAt isActive');
  if (!animal || animal.deletedAt || !animal.isActive) return res.status(409).json({ error: 'animal_not_publishable' });

  const media = await validateOwnedMedia((doc.media || []).map((id) => String(id)), String(doc.seller));
  if (!media.ok) return res.status(403).json({ error: media.reason });

  const capacity = await consumeListingSlot(doc.seller);
  if (!capacity.consumed) return res.status(409).json({ error: 'membership_limit_reached', remaining: 0 });

  doc.status = 'published';
  doc.publishedAt = doc.publishedAt || new Date();
  try {
    await doc.save();
  } catch (error) {
    await releaseListingSlot(doc.seller);
    throw error;
  }

  await audit(user.sub, 'LISTING_PUBLISHED', 'Listing', doc._id);
  await Notification.create({
    userId: doc.seller,
    type: 'listing_published',
    title: 'Publicación activa',
    message: 'Tu publicación de ganado ya está visible en el marketplace.',
    read: false,
  });
  res.json(doc);
}

export async function archiveListing(req: Request, res: Response) {
  const user = (req as any).user;
  const doc = await Listing.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const isOwner = String(doc.seller) === user.sub;
  const canArchive = isOwner || ['admin', 'super'].includes(user.role);
  if (!canArchive) return res.status(403).json({ error: 'Forbidden' });
  if (doc.status === 'archived') return res.json(doc);

  const shouldReleaseCapacity = consumesListingCapacity(doc.status);
  doc.status = 'archived';
  doc.archivedAt = doc.archivedAt || new Date();
  await doc.save();
  if (shouldReleaseCapacity) await releaseListingSlot(doc.seller);

  await audit(user.sub, 'LISTING_ARCHIVED', 'Listing', doc._id);
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
  if (shouldReleaseCapacity) await releaseListingSlot(doc.seller);
  await audit(user.sub, 'LISTING_DELETED', 'Listing', doc._id);
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
  const doc = await Registry.create({ name: req.body.name, authority: req.body.authority, country: req.body.country });
  res.status(201).json(doc);
}
