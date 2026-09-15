import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { getJourneyPlans, getMembershipJourney } from '../../domain/memberships/membershipJourney.service';
import { Animal } from '../../domain/animals/animal.model';
import { Listing } from '../../domain/listings/listing.model';
import { isPaidUpgrade } from '../../domain/memberships/membershipChange.service';

const router = Router();

/** Recommendation is eligibility against real benefits, not an invented commercial tier. */
router.post('/membership/journey/recommend', async (req, res) => {
  const { listings, photos, prioritySupport } = req.body ?? {};
  if (!Number.isSafeInteger(listings) || listings < 0 || !Number.isSafeInteger(photos) || photos < 0 || typeof prioritySupport !== 'boolean') {
    return res.status(400).json({ error: 'invalid_requirements' });
  }
  const { items } = await getJourneyPlans();
  res.json({ items: items.filter(plan => plan.benefits.maxActiveListings >= listings && plan.benefits.maxPhotosPerListing >= photos && (!prioritySupport || plan.benefits.supportLevel === 'priority')) });
});

router.get('/account/membership/journey', requireAuth, async (req, res) => {
  res.json(await getMembershipJourney((req as any).user.sub));
});

router.get('/account/membership/journey/change-preview', requireAuth, async (req, res) => {
  const journey = await getMembershipJourney((req as any).user.sub);
  const catalog = await getJourneyPlans();
  const target = catalog.items.find(plan => plan.code === req.query.plan);
  if (!target || !journey.plan) return res.status(404).json({ error: 'membership_plan_not_found' });
  const unchanged = target._id === journey.plan._id;
  const requiresCheckout = isPaidUpgrade(journey.plan, target);
  res.json({ target, unchanged, requiresCheckout,
    allowed: journey.actions.changePlan && !unchanged && !requiresCheckout,
    effectiveAt: requiresCheckout || unchanged ? null : journey.membership.currentPeriodEnd,
    activeListings: journey.capacity.activeListings,
    notice: requiresCheckout ? journey.capabilities.paidCheckoutReason : journey.capabilities.changeNotice,
  });
});

/** Owner-scoped recovery of saved work; never trust a userId supplied by the client. */
router.get('/account/membership/catalog', requireAuth, async (req, res) => {
  const owner = (req as any).user.sub;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 20;
  const [animals, listings, total] = await Promise.all([
    Animal.find({ owner, deletedAt: null, isActive: true }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .select('_id tag name breed sex location').lean(),
    Listing.find({ seller: owner }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit)
      .populate('media').lean(),
    Listing.countDocuments({ seller: owner }),
  ]);
  const animalTotal = await Animal.countDocuments({ owner, deletedAt: null, isActive: true });
  res.json({ animals, listings, page, pages: Math.ceil(Math.max(total, animalTotal) / limit) });
});

export default router;
