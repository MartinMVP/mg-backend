import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Animal } from '../../domain/animals/animal.model';
import { Listing } from '../../domain/listings/listing.model';
import { Breed } from '../../domain/breeds/breed.model';
import { Registry } from '../../domain/registries/registry.model';

// Helpers
function num(v: any, def: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function bool(v: any, def = false) {
  if (v === undefined) return def;
  return ['1','true','yes','on'].includes(String(v).toLowerCase());
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

  // q: buscar por tag/name (índice de texto)
  if (q && q.trim()) {
    filter.$text = { $search: q.trim() };
  }

  // edad: calcular por birthDate
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
  const data = { ...req.body, owner: user.sub, deletedAt: null };
  const doc = await Animal.create(data);
  res.status(201).json(doc);
}

export async function updateAnimal(req: Request, res: Response) {
  const user = (req as any).user;
  const doc = await Animal.findById(req.params.id);
  if (!doc || doc.deletedAt) return res.status(404).json({ error: 'Not found' });

  const isOwner = String(doc.owner) === user.sub;
  const canEdit = isOwner || ['admin', 'super'].includes(user.role);
  if (!canEdit) return res.status(403).json({ error: 'Forbidden' });

  Object.assign(doc, req.body);
  await doc.save();
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
  res.json({ ok: true });
}

// ---------- Listings ----------
export async function listListings(req: Request, res: Response) {
  const {
    breed, sex, state, minPrice, maxPrice, page = '1', limit = '20', featured
  } = req.query as Record<string, string>;

  const filter: any = { status: 'published' };

  if (Number.isFinite(Number(minPrice))) filter.price = { ...(filter.price || {}), $gte: Number(minPrice) };
  if (Number.isFinite(Number(maxPrice))) filter.price = { ...(filter.price || {}), $lte: Number(maxPrice) };
  if (bool(featured, false)) filter.featured = true;

  // filtros por datos del animal (via populate match)
  const animalMatch: any = {};
  if (breed && Types.ObjectId.isValid(breed)) animalMatch.breed = breed;
  if (sex) animalMatch.sex = sex;
  if (state) animalMatch['location.state'] = state;

  const pageNum = Math.max(1, Number(page) || 1);
  const perPage = Math.min(100, Math.max(1, Number(limit) || 20));
  const skip = (pageNum - 1) * perPage;

  const q = Listing.find(filter)
    .populate({ path: 'animal', match: animalMatch, populate: ['breed', 'registry'] })
    .skip(skip).limit(perPage)
    .sort({ featured: -1, createdAt: -1 });

  const [itemsRaw, total] = await Promise.all([q, Listing.countDocuments(filter)]);
  const items = itemsRaw.filter(it => it.animal); // descarta las que no cumplieron el match

  res.json({ items, total, page: pageNum, pages: Math.ceil(total / perPage) });
}

export async function getListing(req: Request, res: Response) {
  const doc = await Listing.findById(req.params.id)
    .populate({ path: 'animal', populate: ['breed', 'registry'] });
  if (!doc) return res.status(404).json({ error: 'Not found' });
  res.json(doc);
}

export async function createListing(req: Request, res: Response) {
  const user = (req as any).user;
  const payload = { ...req.body, seller: user.sub };
  const doc = await Listing.create(payload);
  res.status(201).json(doc);
}

export async function updateListing(req: Request, res: Response) {
  const user = (req as any).user;
  const doc = await Listing.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const isOwner = String(doc.seller) === user.sub;
  const canEdit = isOwner || ['admin', 'super'].includes(user.role);
  if (!canEdit) return res.status(403).json({ error: 'Forbidden' });

  Object.assign(doc, req.body);
  await doc.save();
  res.json(doc);
}

export async function deleteListing(req: Request, res: Response) {
  const user = (req as any).user;
  const doc = await Listing.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });

  const isOwner = String(doc.seller) === user.sub;
  const canDelete = isOwner || ['admin', 'super'].includes(user.role);
  if (!canDelete) return res.status(403).json({ error: 'Forbidden' });

  await doc.deleteOne();
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
