import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
import { Audit } from '../../domain/audit/audit.model';
import { membershipAuditActions } from '../../domain/memberships/membership.audit';
import { MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { ensureMembershipUsageForPeriod } from '../../domain/memberships/membership.service';
import { MembershipUsage } from '../../domain/memberships/membershipUsage.model';
import {
  operationallyActiveMembershipStatuses,
  UserMembership,
} from '../../domain/memberships/userMembership.model';

const router = Router();

function isValidObjectId(id: string) {
  return Types.ObjectId.isValid(id);
}

function pickPlanPayload(body: any) {
  const payload: Record<string, unknown> = {};
  for (const key of [
    'name',
    'code',
    'description',
    'price',
    'currency',
    'billingPeriod',
    'benefits',
    'isActive',
    'isPublic',
    'trialDays',
    'sortOrder',
  ]) {
    if (body[key] !== undefined) payload[key] = body[key];
  }
  return payload;
}

function requireAdmin(req: any, res: any, next: any) {
  return requireRole('admin', 'super')(req, res, next);
}

router.use(requireAuth, requireAdmin);

router.get('/membership/plans', async (_req, res) => {
  const plans = await MembershipPlan.find().sort({ sortOrder: 1 }).lean();
  res.json({ items: plans });
});

router.post('/membership/plans', async (req, res) => {
  const user = (req as any).user;
  try {
    const plan = await MembershipPlan.create(pickPlanPayload(req.body ?? {}));
    await Audit.create({ actor: user?.sub || 'system', action: membershipAuditActions.planCreated });
    res.status(201).json(plan);
  } catch (error: any) {
    if (error?.code === 11000) return res.status(409).json({ error: 'Membership plan code already exists' });
    throw error;
  }
});

router.patch('/membership/plans/:id', async (req, res) => {
  const user = (req as any).user;
  const id = String(req.params.id);
  if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid membership plan id' });

  try {
    const plan = await MembershipPlan.findByIdAndUpdate(
      id,
      { $set: pickPlanPayload(req.body ?? {}) },
      { new: true, runValidators: true }
    );
    if (!plan) return res.status(404).json({ error: 'Not found' });
    await Audit.create({ actor: user?.sub || 'system', action: membershipAuditActions.planUpdated });
    res.json(plan);
  } catch (error: any) {
    if (error?.code === 11000) return res.status(409).json({ error: 'Membership plan code already exists' });
    throw error;
  }
});

router.get('/membership/subscriptions', async (_req, res) => {
  const subscriptions = await UserMembership.find()
    .sort({ createdAt: -1 })
    .populate({ path: 'userId', select: 'name email role' })
    .populate({ path: 'planId' })
    .lean();

  res.json({ items: subscriptions });
});

router.get('/membership/subscriptions/:id', async (req, res) => {
  const id = String(req.params.id);
  if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid membership id' });

  const membership = await UserMembership.findById(id)
    .populate({ path: 'userId', select: 'name email role' })
    .populate({ path: 'planId' })
    .lean();
  if (!membership) return res.status(404).json({ error: 'Not found' });

  const usage = await MembershipUsage.findOne({
    membershipId: membership._id,
    periodStart: membership.currentPeriodStart,
    periodEnd: membership.currentPeriodEnd,
  }).lean();

  res.json({ membership, usage });
});

router.post('/membership/subscriptions/:id/activate', async (req, res) => {
  const user = (req as any).user;
  const id = String(req.params.id);
  if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid membership id' });

  const membership = await UserMembership.findById(id);
  if (!membership) return res.status(404).json({ error: 'Not found' });

  const existingActive = await UserMembership.findOne({
    _id: { $ne: membership._id },
    userId: membership.userId,
    status: { $in: operationallyActiveMembershipStatuses },
  });
  if (existingActive) return res.status(409).json({ error: 'User already has an active membership' });

  membership.status = 'active';
  membership.suspendedAt = undefined;
  membership.cancelledAt = undefined;
  await membership.save();
  await ensureMembershipUsageForPeriod(membership);
  await Audit.create({ actor: user?.sub || 'system', action: membershipAuditActions.activated });

  res.json(membership);
});

router.post('/membership/subscriptions/:id/suspend', async (req, res) => {
  const user = (req as any).user;
  const id = String(req.params.id);
  if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid membership id' });

  const membership = await UserMembership.findByIdAndUpdate(
    id,
    { $set: { status: 'suspended', suspendedAt: new Date() } },
    { new: true, runValidators: true }
  );
  if (!membership) return res.status(404).json({ error: 'Not found' });

  await Audit.create({ actor: user?.sub || 'system', action: membershipAuditActions.suspended });
  res.json(membership);
});

router.post('/membership/subscriptions/:id/cancel', async (req, res) => {
  const user = (req as any).user;
  const id = String(req.params.id);
  if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid membership id' });

  const membership = await UserMembership.findByIdAndUpdate(
    id,
    { $set: { status: 'cancelled', cancelledAt: new Date() } },
    { new: true, runValidators: true }
  );
  if (!membership) return res.status(404).json({ error: 'Not found' });

  await Audit.create({ actor: user?.sub || 'system', action: membershipAuditActions.cancelled });
  res.json(membership);
});

export default router;
