import { Router } from 'express';
import { Types } from 'mongoose';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
import { MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { PaymentCheckoutSession } from '../../domain/payments/paymentCheckoutSession.model';
import { PaymentCustomer } from '../../domain/payments/paymentCustomer.model';
import { PaymentRecord } from '../../domain/payments/paymentRecord.model';
import { PaymentWebhookLog } from '../../domain/payments/paymentWebhookLog.model';
import { MembershipPaymentTransaction } from '../../domain/payments/membershipPaymentTransaction.model';
import { DunningState } from '../../domain/payments/dunningState.model';
import { processDunningDue } from '../../domain/payments/dunning.service';
import { listReconciliations, reconcilePayments } from '../../domain/payments/commercialRevenue.service';
import { Audit } from '../../domain/audit/audit.model';

const router = Router();

function requireAdmin(req: any, res: any, next: any) {
  return requireRole('admin', 'super')(req, res, next);
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

router.use(requireAuth, requireAdmin);


router.get('/payments', async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const query: Record<string, any> = {};
  if (req.query.status) query.status = String(req.query.status);
  if (req.query.userId && Types.ObjectId.isValid(String(req.query.userId))) query.userId = String(req.query.userId);

  const [items, total] = await Promise.all([
    MembershipPaymentTransaction.find(query)
      .sort({ processedAt: -1, createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'userId', select: 'name email role' })
      .populate({ path: 'planId', select: 'name code monthlyPrice yearlyPrice durationDays' })
      .lean(),
    MembershipPaymentTransaction.countDocuments(query),
  ]);

  res.json({ items, page, limit, total });
});

router.get('/payments/customers', async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const items = await PaymentCustomer.find()
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .select('-__v')
    .lean();

  res.json({ items, page, limit });
});

router.get('/payments/checkout-sessions', async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const items = await PaymentCheckoutSession.find()
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .select('-__v')
    .lean();

  res.json({ items, page, limit });
});

router.get('/payments/records', async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const query: Record<string, any> = { ...parseDateFilter(req.query) };

  if (req.query.status) query.status = String(req.query.status);
  if (req.query.provider) query.provider = String(req.query.provider);
  if (req.query.userId && Types.ObjectId.isValid(String(req.query.userId))) query.userId = String(req.query.userId);
  if (req.query.membershipPlan) {
    if (String(req.query.membershipPlan).match(/^[a-f\d]{24}$/i)) {
      query.membershipPlanId = String(req.query.membershipPlan);
    } else {
      const plan = await MembershipPlan.findOne({ code: String(req.query.membershipPlan).toLowerCase().trim() })
        .select('_id')
        .lean();
      query.membershipPlanId = plan?._id ?? '000000000000000000000000';
    }
  }

  const [items, total] = await Promise.all([
    PaymentRecord.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
      .populate({ path: 'userId', select: 'name email role' })
      .populate({ path: 'membershipPlanId', select: 'name code price currency billingPeriod' })
    .select('-__v')
      .lean(),
    PaymentRecord.countDocuments(query),
  ]);

  res.json({ items, page, limit, total });
});

router.get('/payments/webhook-logs', async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const items = await PaymentWebhookLog.find()
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .select('-__v')
    .lean();

  res.json({ items, page, limit });
});

router.get('/payments/dunning', async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const query: Record<string, any> = { ...parseDateFilter(req.query) };

  if (req.query.status) query.status = String(req.query.status);
  if (req.query.userId && Types.ObjectId.isValid(String(req.query.userId))) query.userId = String(req.query.userId);
  if (req.query.plan) {
    const plan = await MembershipPlan.findOne({ code: String(req.query.plan).toLowerCase().trim() }).select('_id').lean();
    const memberships = await UserMembership.find({ planId: plan?._id ?? '000000000000000000000000' }).select('_id').lean();
    query.userMembershipId = { $in: memberships.map((membership) => membership._id) };
  }

  const [items, total] = await Promise.all([
    DunningState.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
      .populate({ path: 'userId', select: 'name email role' })
      .populate({ path: 'userMembershipId' })
    .select('-__v')
      .lean(),
    DunningState.countDocuments(query),
  ]);

  res.json({ items, page, limit, total });
});

router.get('/payments/dunning/:id', async (req, res) => {
  if (!req.params.id.match(/^[a-f\d]{24}$/i)) {
    return res.status(400).json({ error: 'Invalid dunning id' });
  }

  const item = await DunningState.findById(req.params.id).select('-__v').lean();
  if (!item) return res.status(404).json({ error: 'Not found' });

  res.json(item);
});

router.post('/payments/dunning/process-due', async (_req, res) => {
  const result = await processDunningDue();
  res.json(result);
});

router.post('/payments/reconcile', async (req, res) => {
  const user = (req as any).user;
  const result = await reconcilePayments(user.sub, String(req.body?.provider || 'internal'));
  await Audit.create({
    actor: user.sub,
    action: 'ADMIN_PAYMENT_RECONCILED',
    metadata: { reconciliationId: String((result as any)._id) },
  } as any);
  res.status(201).json(result);
});

router.get('/payments/reconciliation', async (req, res) => {
  res.json(await listReconciliations(req.query));
});

router.get('/payments/:id', async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'invalid_payment_id' });
  const payment = await MembershipPaymentTransaction.findById(id)
    .populate({ path: 'userId', select: 'name email role' })
    .populate({ path: 'planId', select: 'name code monthlyPrice yearlyPrice durationDays' })
    .lean();
  if (!payment) return res.status(404).json({ error: 'payment_not_found' });
  res.json(payment);
});

export default router;



