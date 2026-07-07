import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
import { Audit } from '../../domain/audit/audit.model';
import { User } from '../../domain/users/user.model';
import { DunningState } from '../../domain/payments/dunningState.model';
import { membershipAuditActions } from '../../domain/memberships/membership.audit';
import { MembershipChangeLog } from '../../domain/memberships/membershipChangeLog.model';
import { getMembershipDashboard } from '../../domain/memberships/membershipMetrics.service';
import { MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { ensureMembershipUsageForPeriod } from '../../domain/memberships/membership.service';
import { MembershipUsage } from '../../domain/memberships/membershipUsage.model';
import {
  operationallyActiveMembershipStatuses,
  UserMembership,
} from '../../domain/memberships/userMembership.model';
import {
  processMembershipPendingChanges,
  reactivateMembership,
  requestCancellation,
  requestPlanChange,
} from '../../domain/memberships/membershipChange.service';

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

function membershipChangeError(res: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'membership_plan_code_required') return res.status(400).json({ error: message });
  if (message === 'membership_plan_not_found') return res.status(404).json({ error: message });
  if (message === 'membership_not_found') return res.status(404).json({ error: message });
  throw error;
}

function parsePagination(query: any) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit };
}

function parseDateFilter(query: any) {
  const createdAt: Record<string, Date> = {};
  if (query.createdAfter) createdAt.$gte = new Date(String(query.createdAfter));
  if (query.createdBefore) createdAt.$lte = new Date(String(query.createdBefore));
  return Object.keys(createdAt).length ? { createdAt } : {};
}

function csvEscape(value: unknown) {
  const text = value === undefined || value === null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

router.use(requireAuth, requireAdmin);

router.get('/membership/dashboard', async (_req, res) => {
  res.json(await getMembershipDashboard());
});

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

router.get('/membership/subscriptions', async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const query: Record<string, any> = { ...parseDateFilter(req.query) };

  if (req.query.status) query.status = String(req.query.status);
  if (req.query.userId && isValidObjectId(String(req.query.userId))) query.userId = String(req.query.userId);
  if (req.query.plan) {
    const plan = await MembershipPlan.findOne({ code: String(req.query.plan).toLowerCase().trim() }).select('_id').lean();
    query.planId = plan?._id ?? new Types.ObjectId();
  }
  if (req.query.email) {
    const users = await User.find({ email: { $regex: String(req.query.email), $options: 'i' } }).select('_id').lean();
    query.userId = { $in: users.map((user) => user._id) };
  }

  const [subscriptions, total] = await Promise.all([
    UserMembership.find(query)
    .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
    .populate({ path: 'userId', select: 'name email role' })
    .populate({ path: 'planId' })
      .lean(),
    UserMembership.countDocuments(query),
  ]);

  const dunningRows = await DunningState.find({
    userMembershipId: { $in: subscriptions.map((membership) => membership._id) },
    status: 'active',
  }).select('userMembershipId').lean();
  const activeDunning = new Set(dunningRows.map((row) => String(row.userMembershipId)));

  res.json({
    items: subscriptions.map((membership) => ({
      ...membership,
      dunningActive: activeDunning.has(String(membership._id)),
    })),
    page,
    limit,
    total,
  });
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

router.get('/membership/subscriptions/:id/usage', async (req, res) => {
  const id = String(req.params.id);
  if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid membership id' });

  const membership = await UserMembership.findById(id).lean();
  if (!membership) return res.status(404).json({ error: 'Not found' });

  const usage = await MembershipUsage.findOne({
    membershipId: membership._id,
    periodStart: membership.currentPeriodStart,
    periodEnd: membership.currentPeriodEnd,
  }).lean();

  res.json({ membershipId: membership._id, usage });
});

router.get('/membership/change-logs', async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const query: Record<string, any> = { ...parseDateFilter(req.query) };
  if (req.query.changeType) query.changeType = String(req.query.changeType);
  if (req.query.source) query.source = String(req.query.source);
  if (req.query.userId && isValidObjectId(String(req.query.userId))) query.userId = String(req.query.userId);

  const [items, total] = await Promise.all([
    MembershipChangeLog.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'userId', select: 'name email role' })
      .populate({ path: 'fromPlanId', select: 'name code price currency billingPeriod' })
      .populate({ path: 'toPlanId', select: 'name code price currency billingPeriod' })
      .lean(),
    MembershipChangeLog.countDocuments(query),
  ]);

  res.json({ items, page, limit, total });
});

router.post('/membership/process-pending-changes', async (_req, res) => {
  const result = await processMembershipPendingChanges();
  res.json(result);
});

router.get('/membership/export', async (_req, res) => {
  const memberships = await UserMembership.find()
    .sort({ createdAt: -1 })
    .populate({ path: 'userId', select: 'name email role' })
    .populate({ path: 'planId', select: 'name code price currency billingPeriod' })
    .lean();

  const header = ['user', 'email', 'plan', 'status', 'startsAt', 'currentPeriodEnd', 'cancelAtPeriodEnd'];
  const rows = memberships.map((membership) => {
    const user = membership.userId as any;
    const plan = membership.planId as any;
    return [
      user?.name,
      user?.email,
      plan?.code,
      membership.status,
      membership.startsAt?.toISOString?.(),
      membership.currentPeriodEnd?.toISOString?.(),
      membership.cancelAtPeriodEnd ? 'true' : 'false',
    ].map(csvEscape).join(',');
  });

  res.type('text/csv').send([header.join(','), ...rows].join('\n'));
});

router.post('/membership/subscriptions/:id/change-plan', async (req, res) => {
  const id = String(req.params.id);
  if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid membership id' });

  try {
    const result = await requestPlanChange({
      membershipId: id,
      targetPlanCode: String(req.body?.targetPlanCode || req.body?.planCode || ''),
      source: 'admin',
    });

    res.status(result.requiresCheckout ? 409 : 200).json(result);
  } catch (error) {
    return membershipChangeError(res, error);
  }
});

router.post('/membership/subscriptions/:id/cancel', async (req, res) => {
  const id = String(req.params.id);
  if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid membership id' });

  try {
    const result = await requestCancellation({
      membershipId: id,
      reason: req.body?.reason ? String(req.body.reason) : undefined,
      source: 'admin',
    });

    res.json(result);
  } catch (error) {
    return membershipChangeError(res, error);
  }
});

router.post('/membership/subscriptions/:id/reactivate', async (req, res) => {
  const id = String(req.params.id);
  if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid membership id' });

  try {
    const result = await reactivateMembership({
      membershipId: id,
      source: 'admin',
    });

    res.status(result.ok ? 200 : 409).json(result);
  } catch (error) {
    return membershipChangeError(res, error);
  }
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


export default router;
