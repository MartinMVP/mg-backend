import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { FiscalOperation } from '../fiscalOperations/fiscalOperation.model';
import { executeFiscalRecovery } from '../fiscalOperations/fiscalPlatform.service';
import { Listing } from '../listings/listing.model';
import { UserMembership, membershipStatuses, MembershipStatus } from '../memberships/userMembership.model';
import { Conversation } from '../messaging/conversation.model';
import { Message } from '../messaging/message.model';
import { CommercialOperation } from '../payments/commercialOperation.model';
import { PaymentTransaction } from '../payments/paymentTransaction.model';
import { ReconciliationRecord } from '../payments/reconciliationRecord.model';
import { reconcilePayments } from '../payments/commercialRevenue.service';
import { User } from '../users/user.model';

export const operationalWorkspaceAuditActions = {
  userSuspended: 'ADMIN_USER_SUSPENDED',
  listingArchived: 'ADMIN_LISTING_ARCHIVED',
  paymentReconciled: 'ADMIN_PAYMENT_RECONCILED',
  fiscalRecovered: 'ADMIN_FISCAL_RECOVERED',
  membershipUpdated: 'ADMIN_MEMBERSHIP_UPDATED',
  conversationClosed: 'ADMIN_CONVERSATION_CLOSED',
} as const;

function assertObjectId(id: string, error = 'invalid_object_id') {
  if (!Types.ObjectId.isValid(id)) throw Object.assign(new Error(error), { status: 400 });
  return new Types.ObjectId(id);
}

function pagination(query: any) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  return { page, limit };
}

async function audit(actor: string, action: string, metadata: Record<string, unknown> = {}) {
  await Audit.create({ actor, action, metadata } as any);
}

export async function getOperationalDashboard() {
  const [
    users,
    memberships,
    listings,
    conversations,
    payments,
    fiscal,
    needsAttention,
    queue,
  ] = await Promise.all([
    User.countDocuments(),
    UserMembership.countDocuments(),
    Listing.countDocuments(),
    Conversation.countDocuments(),
    PaymentTransaction.countDocuments(),
    FiscalOperation.countDocuments(),
    getNeedsAttention({ limit: 10 }),
    getOperationalQueue({ limit: 10 }),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    kpis: {
      users,
      memberships,
      listings,
      conversations,
      payments,
      fiscalOperations: fiscal,
      needsAttention: needsAttention.total,
      operationalQueue: queue.total,
    },
    workspaces: {
      marketplace: { listings },
      membership: { memberships },
      revenue: { payments },
      fiscal: { operations: fiscal },
      messaging: { conversations },
      users: { users },
    },
  };
}

export async function listUsers(query: any = {}) {
  const { page, limit } = pagination(query);
  const filter: Record<string, unknown> = {};
  if (query.role) filter.role = String(query.role);
  if (query.status) filter.status = String(query.status);
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).select('-password').lean(),
    User.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

export async function listMemberships(query: any = {}) {
  const { page, limit } = pagination(query);
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = String(query.status);
  const [items, total] = await Promise.all([
    UserMembership.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate({ path: 'userId', select: 'name email role status' })
      .populate({ path: 'planId', select: 'name code' })
      .lean(),
    UserMembership.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

export async function listListings(query: any = {}) {
  const { page, limit } = pagination(query);
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = String(query.status);
  const [items, total] = await Promise.all([
    Listing.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Listing.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

export async function listConversations(query: any = {}) {
  const { page, limit } = pagination(query);
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = String(query.status);
  if (query.type) filter.type = String(query.type);
  const [items, total] = await Promise.all([
    Conversation.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Conversation.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

export async function getFiscalWorkspace(query: any = {}) {
  const { page, limit } = pagination(query);
  const filter: Record<string, unknown> = {};
  if (query.status) filter.invoiceStatus = String(query.status);
  const [items, total, failed, cancellationRequested] = await Promise.all([
    FiscalOperation.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    FiscalOperation.countDocuments(filter),
    FiscalOperation.countDocuments({ invoiceStatus: 'failed' }),
    FiscalOperation.countDocuments({ invoiceStatus: 'cancellation_requested' }),
  ]);
  return { items, page, limit, total, kpis: { failed, cancellationRequested } };
}

export async function getOperationalQueue(query: any = {}) {
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const [failedPayments, failedFiscal, openConversations, pendingMemberships] = await Promise.all([
    PaymentTransaction.find({ status: 'failed' }).sort({ updatedAt: -1 }).limit(limit).lean(),
    FiscalOperation.find({ invoiceStatus: 'failed' }).sort({ updatedAt: -1 }).limit(limit).lean(),
    Conversation.find({ status: 'active' }).sort({ updatedAt: 1 }).limit(limit).lean(),
    UserMembership.find({ status: 'pending_activation' }).sort({ updatedAt: 1 }).limit(limit).lean(),
  ]);
  const items = [
    ...failedPayments.map((item) => ({ type: 'payment_failed', priority: 'high', item })),
    ...failedFiscal.map((item) => ({ type: 'fiscal_failed', priority: 'high', item })),
    ...pendingMemberships.map((item) => ({ type: 'membership_pending_activation', priority: 'medium', item })),
    ...openConversations.map((item) => ({ type: 'conversation_active', priority: 'low', item })),
  ].slice(0, limit);
  return { items, total: items.length };
}

export async function getNeedsAttention(query: any = {}) {
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const [paymentFailures, fiscalFailures, staleConversations, archivedListings] = await Promise.all([
    PaymentTransaction.countDocuments({ status: 'failed' }),
    FiscalOperation.countDocuments({ invoiceStatus: 'failed' }),
    Conversation.countDocuments({ status: 'active', messageCount: { $gt: 0 } }),
    Listing.countDocuments({ status: 'archived' }),
  ]);
  const items = [
    { type: 'payment_failures', severity: paymentFailures > 0 ? 'high' : 'none', count: paymentFailures },
    { type: 'fiscal_failures', severity: fiscalFailures > 0 ? 'high' : 'none', count: fiscalFailures },
    { type: 'active_conversations', severity: staleConversations > 0 ? 'medium' : 'none', count: staleConversations },
    { type: 'archived_listings', severity: archivedListings > 0 ? 'low' : 'none', count: archivedListings },
  ].filter((item) => item.count > 0).slice(0, limit);
  return { items, total: items.reduce((sum, item) => sum + item.count, 0) };
}

export async function suspendUser(userId: string, actorId: string) {
  const user = await User.findByIdAndUpdate(
    assertObjectId(userId, 'invalid_user_id'),
    { $set: { status: 'suspended' } },
    { new: true, runValidators: false },
  ).select('-password');
  if (!user) throw Object.assign(new Error('user_not_found'), { status: 404 });
  await audit(actorId, operationalWorkspaceAuditActions.userSuspended, { userId });
  return user;
}

export async function archiveListing(listingId: string, actorId: string) {
  const listing = await Listing.findByIdAndUpdate(
    assertObjectId(listingId, 'invalid_listing_id'),
    { $set: { status: 'archived', archivedAt: new Date() } },
    { new: true, runValidators: true },
  );
  if (!listing) throw Object.assign(new Error('listing_not_found'), { status: 404 });
  await audit(actorId, operationalWorkspaceAuditActions.listingArchived, { listingId });
  return listing;
}

export async function updateMembership(membershipId: string, status: string, actorId: string) {
  if (!membershipStatuses.includes(status as MembershipStatus)) {
    throw Object.assign(new Error('invalid_membership_status'), { status: 400 });
  }
  const membership = await UserMembership.findByIdAndUpdate(
    assertObjectId(membershipId, 'invalid_membership_id'),
    { $set: { status, metadata: { operationalWorkspaceUpdatedAt: new Date().toISOString() } } },
    { new: true, runValidators: true },
  );
  if (!membership) throw Object.assign(new Error('membership_not_found'), { status: 404 });
  await audit(actorId, operationalWorkspaceAuditActions.membershipUpdated, { membershipId, status });
  return membership;
}

export async function closeConversation(conversationId: string, actorId: string) {
  const conversation = await Conversation.findByIdAndUpdate(
    assertObjectId(conversationId, 'invalid_conversation_id'),
    { $set: { status: 'closed', closedAt: new Date() } },
    { new: true, runValidators: true },
  );
  if (!conversation) throw Object.assign(new Error('conversation_not_found'), { status: 404 });
  await audit(actorId, operationalWorkspaceAuditActions.conversationClosed, { conversationId });
  return conversation;
}

export async function reconcilePaymentsFromWorkspace(actorId: string) {
  const result = await reconcilePayments(actorId, 'internal');
  await audit(actorId, operationalWorkspaceAuditActions.paymentReconciled, { reconciliationId: String(result._id) });
  return result;
}

export async function recoverFiscalFromWorkspace(actorId: string) {
  const result = await executeFiscalRecovery(actorId);
  await audit(actorId, operationalWorkspaceAuditActions.fiscalRecovered, result);
  return result;
}

export async function operationalKpis() {
  const [messages, operations, reconciliations] = await Promise.all([
    Message.countDocuments(),
    CommercialOperation.countDocuments(),
    ReconciliationRecord.countDocuments(),
  ]);
  return { messages, commercialOperations: operations, reconciliations };
}
