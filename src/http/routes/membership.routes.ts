import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
import { getUserMembership } from '../../domain/memberships/membership.service';
import { getMembershipCapacity } from '../../domain/memberships/membershipCatalogPolicy';
import { requestMembershipPurchaseCheckout } from '../../domain/payments/membershipPurchase.service';
import { MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { MembershipBenefit } from '../../domain/memberships/membershipBenefit.model';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { MembershipHistory } from '../../domain/memberships/membershipHistory.model';
import {
  activateMembership,
  cancelMembership,
  createMembership,
  createMembershipPlan,
  expireMembership,
  listMembershipHistory,
  reactivateFoundationMembership,
  setMembershipPlanActive,
  suspendMembership,
  updateMembershipPlan,
} from '../../domain/memberships/membershipFoundation.service';
import {
  reactivateMembership,
  requestCancellation,
  requestPlanChange,
} from '../../domain/memberships/membershipChange.service';

const router = Router();
const requireMembershipAdmin = requireRole('admin', 'super');

function isValidObjectId(id: string) {
  return Types.ObjectId.isValid(id);
}

function parsePagination(query: any) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit };
}

function membershipFoundationError(res: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('invalid_')) return res.status(400).json({ error: message });
  if (message.endsWith('_not_found')) return res.status(404).json({ error: message });
  if (message.includes('cannot') || message === 'active_membership_exists' || message === 'membership_benefit_limit_reached') return res.status(409).json({ error: message });
  if (message === 'membership_plan_required_fields' || message === 'membership_benefit_not_supported') return res.status(400).json({ error: message });
  throw error;
}

function membershipChangeError(res: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'membership_plan_code_required') return res.status(400).json({ error: message });
  if (message === 'membership_plan_not_found') return res.status(404).json({ error: message });
  if (message === 'membership_not_found') return res.status(404).json({ error: message });
  throw error;
}


router.get('/membership/plans', async (_req, res) => {
  const plans = await MembershipPlan.find({ isActive: true }).sort({ sortOrder: 1, createdAt: -1 }).lean();
  res.json({ items: plans });
});

router.post('/membership/plans', requireAuth, requireMembershipAdmin, async (req, res) => {
  try {
    const plan = await createMembershipPlan(req.body ?? {}, (req as any).user?.sub);
    res.status(201).json(plan);
  } catch (error: any) {
    if (error?.code === 11000) return res.status(409).json({ error: 'membership_plan_code_exists' });
    return membershipFoundationError(res, error);
  }
});

router.patch('/membership/plans/:id', requireAuth, requireMembershipAdmin, async (req, res) => {
  try {
    if (req.body?.isActive === true && Object.keys(req.body).length === 1) {
      return res.json(await setMembershipPlanActive(String(req.params.id), true, (req as any).user?.sub));
    }
    if (req.body?.isActive === false && Object.keys(req.body).length === 1) {
      return res.json(await setMembershipPlanActive(String(req.params.id), false, (req as any).user?.sub));
    }
    res.json(await updateMembershipPlan(String(req.params.id), req.body ?? {}, (req as any).user?.sub));
  } catch (error: any) {
    if (error?.code === 11000) return res.status(409).json({ error: 'membership_plan_code_exists' });
    return membershipFoundationError(res, error);
  }
});

router.get('/memberships', requireAuth, requireMembershipAdmin, async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const query: Record<string, unknown> = {};
  if (req.query.status) query.status = String(req.query.status);
  if (req.query.userId && isValidObjectId(String(req.query.userId))) query.userId = String(req.query.userId);

  const [items, total] = await Promise.all([
    UserMembership.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'planId' })
      .populate({ path: 'userId', select: 'name email role' })
      .lean(),
    UserMembership.countDocuments(query),
  ]);

  res.json({ items, page, limit, total });
});

router.post('/memberships', requireAuth, requireMembershipAdmin, async (req, res) => {
  try {
    const membership = await createMembership(req.body ?? {}, (req as any).user?.sub);
    res.status(201).json(membership);
  } catch (error: any) {
    if (error?.code === 11000) return res.status(409).json({ error: 'active_membership_exists' });
    return membershipFoundationError(res, error);
  }
});

router.post('/membership/checkout', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const result = await requestMembershipPurchaseCheckout({
    userId: user.sub,
    planId: req.body?.planId ? String(req.body.planId) : undefined,
    planCode: req.body?.planCode ? String(req.body.planCode) : undefined,
  });
  res.status(result.status).json(result.body);
});

router.get('/memberships/current', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const membership = await getUserMembership(user.sub);
  res.json(membership);
});

router.get('/memberships/current/benefits', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const membership = await getUserMembership(user.sub);
  const benefits = await MembershipBenefit.find({ membershipId: membership.membership._id }).lean();
  res.json({ membership: membership.membership, plan: membership.plan, benefits, legacyBenefits: membership.benefits, usage: membership.usage });
});

router.get('/memberships/:id', requireAuth, requireMembershipAdmin, async (req, res) => {
  const id = String(req.params.id);
  if (!isValidObjectId(id)) return res.status(400).json({ error: 'invalid_membership_id' });
  const membership = await UserMembership.findById(id)
    .populate({ path: 'planId' })
    .populate({ path: 'userId', select: 'name email role' })
    .lean();
  if (!membership) return res.status(404).json({ error: 'membership_not_found' });
  const [benefits, history] = await Promise.all([
    MembershipBenefit.find({ membershipId: id }).lean(),
    MembershipHistory.find({ membershipId: id }).sort({ createdAt: -1 }).limit(20).lean(),
  ]);
  res.json({ membership, benefits, history });
});

router.patch('/memberships/:id/activate', requireAuth, requireMembershipAdmin, async (req, res) => {
  try {
    res.json(await activateMembership(String(req.params.id), (req as any).user?.sub));
  } catch (error) {
    return membershipFoundationError(res, error);
  }
});

router.patch('/memberships/:id/suspend', requireAuth, requireMembershipAdmin, async (req, res) => {
  try {
    res.json(await suspendMembership(String(req.params.id), (req as any).user?.sub));
  } catch (error) {
    return membershipFoundationError(res, error);
  }
});

router.patch('/memberships/:id/reactivate', requireAuth, requireMembershipAdmin, async (req, res) => {
  try {
    res.json(await reactivateFoundationMembership(String(req.params.id), (req as any).user?.sub));
  } catch (error) {
    return membershipFoundationError(res, error);
  }
});

router.patch('/memberships/:id/cancel', requireAuth, requireMembershipAdmin, async (req, res) => {
  try {
    res.json(await cancelMembership(String(req.params.id), (req as any).user?.sub));
  } catch (error) {
    return membershipFoundationError(res, error);
  }
});

router.patch('/memberships/:id/expire', requireAuth, requireMembershipAdmin, async (req, res) => {
  try {
    res.json(await expireMembership(String(req.params.id), (req as any).user?.sub));
  } catch (error) {
    return membershipFoundationError(res, error);
  }
});

router.get('/memberships/:id/history', requireAuth, requireMembershipAdmin, async (req, res) => {
  try {
    res.json({ items: await listMembershipHistory(String(req.params.id)) });
  } catch (error) {
    return membershipFoundationError(res, error);
  }
});

router.get('/account/membership', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const membership = await getUserMembership(user.sub);

  res.json(membership);
});

router.get('/account/membership/capacity', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const capacity = await getMembershipCapacity(user.sub);

  res.json({
    plan: capacity.plan?.code ?? null,
    activeListings: capacity.activeListings,
    maxActiveListings: capacity.maxActiveListings,
    remaining: capacity.grantsBenefits ? capacity.remaining : 0,
  });
});

router.post('/account/membership/change-plan', requireAuth, async (req, res) => {
  const user = (req as any).user;
  try {
    const result = await requestPlanChange({
      userId: user.sub,
      targetPlanCode: String(req.body?.targetPlanCode || req.body?.planCode || ''),
      source: 'user',
    });

    res.status(result.requiresCheckout ? 409 : 200).json(result);
  } catch (error) {
    return membershipChangeError(res, error);
  }
});

router.post('/account/membership/cancel', requireAuth, async (req, res) => {
  const user = (req as any).user;
  try {
    const result = await requestCancellation({
      userId: user.sub,
      reason: req.body?.reason ? String(req.body.reason) : undefined,
      source: 'user',
    });

    res.json(result);
  } catch (error) {
    return membershipChangeError(res, error);
  }
});

router.post('/account/membership/reactivate', requireAuth, async (req, res) => {
  const user = (req as any).user;
  try {
    const result = await reactivateMembership({
      userId: user.sub,
      source: 'user',
    });

    res.status(result.ok ? 200 : 409).json(result);
  } catch (error) {
    return membershipChangeError(res, error);
  }
});

export default router;




