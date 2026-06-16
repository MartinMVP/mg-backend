import { Audit } from '../audit/audit.model';
import { Animal } from '../animals/animal.model';
import { Auction } from '../auctions/auction.model';
import { FiscalProfile } from '../fiscalProfiles/fiscalProfile.model';
import { InvoiceDraft } from '../invoiceDrafts/invoiceDraft.model';
import { InvoiceQueue } from '../invoiceQueue/invoiceQueue.model';
import { Listing } from '../listings/listing.model';
import { MembershipChangeLog } from '../memberships/membershipChangeLog.model';
import { MembershipPlan } from '../memberships/membershipPlan.model';
import { UserMembership } from '../memberships/userMembership.model';
import { Conversation } from '../messaging/conversation.model';
import { ConversationParticipant } from '../messaging/conversationParticipant.model';
import { Message } from '../messaging/message.model';
import { Notification } from '../notifications/notification.model';
import { DunningState } from '../payments/dunningState.model';
import { PaymentCheckoutSession } from '../payments/paymentCheckoutSession.model';
import { PaymentRecord } from '../payments/paymentRecord.model';
import { PaymentWebhookLog } from '../payments/paymentWebhookLog.model';
import { Transaction } from '../transactions/transaction.model';
import { User } from '../users/user.model';

export const adminControlCenterAuditActions = {
  dashboardViewed: 'ADMIN_CONTROL_CENTER_VIEWED',
  activityViewed: 'ADMIN_ACTIVITY_VIEWED',
  alertsViewed: 'ADMIN_ALERTS_VIEWED',
} as const;

export const adminControlCenterAlertActions = {
  MEMBERSHIP_HIGH_DUNNING_RATE: {
    severity: 'high',
    description: 'High dunning rate detected',
  },
  MEMBERSHIP_HIGH_PAYMENT_FAILURE_RATE: {
    severity: 'critical',
    description: 'High payment failure rate detected',
  },
  MEMBERSHIP_HIGH_CANCELLATION_RATE: {
    severity: 'medium',
    description: 'High membership cancellation rate detected',
  },
} as const;

type HealthStatus = 'healthy' | 'warning' | 'critical';
type ActivityType = 'audit' | 'notification' | 'membership_change' | 'payment_webhook';

const alertActionNames = Object.keys(adminControlCenterAlertActions);

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

export function normalizeAdminLimit(value: unknown, fallback = 25, max = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function mergeHealth(...statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes('critical')) return 'critical';
  if (statuses.includes('warning')) return 'warning';
  return 'healthy';
}

function isoDate(value?: Date | string | null) {
  return value ? new Date(value).toISOString() : null;
}

export async function getAdminControlCenterDashboard() {
  const thirtyDaysAgo = daysAgo(30);
  const [freePlanIds, paidPlanIds] = await Promise.all([
    MembershipPlan.find({ code: 'free' }).distinct('_id'),
    MembershipPlan.find({ price: { $gt: 0 } }).distinct('_id'),
  ]);

  const [
    totalUsers,
    admins,
    newUsersLast30Days,
    activeMemberships,
    freeMemberships,
    paidMemberships,
    gracePeriod,
    inDunning,
    suspended,
    cancellationsScheduled,
    totalAnimals,
    activeListings,
    soldListings,
    archivedListings,
    featuredListings,
    checkoutSessions,
    paymentRecords,
    successfulPayments,
    failedPayments,
    lastPayment,
    activeDunningCases,
    recoveredCases,
    suspendedCases,
    scheduledAuctions,
    liveAuctions,
    pausedAuctions,
    closedAuctions,
    transactions,
    invoiceDrafts,
    invoiceQueue,
    invoiceQueuePending,
    fiscalProfiles,
    conversationsTotal,
    messagesTotal,
    activeConversations,
    archivedConversations,
    closedConversations,
    conversationsWithUnreadMessages,
    unresolvedAlerts,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ role: { $in: ['admin', 'super'] } }),
    User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    UserMembership.countDocuments({ status: 'active' }),
    UserMembership.countDocuments({ planId: { $in: freePlanIds } }),
    UserMembership.countDocuments({ planId: { $in: paidPlanIds } }),
    UserMembership.countDocuments({ status: 'grace_period' }),
    UserMembership.countDocuments({ status: 'in_dunning' }),
    UserMembership.countDocuments({ status: 'suspended' }),
    UserMembership.countDocuments({ cancelAtPeriodEnd: true }),
    Animal.countDocuments({ deletedAt: null }),
    Listing.countDocuments({ status: 'published' }),
    Listing.countDocuments({ status: 'sold' }),
    Listing.countDocuments({ status: 'archived' }),
    Listing.countDocuments({ featured: true }),
    PaymentCheckoutSession.countDocuments(),
    PaymentRecord.countDocuments(),
    PaymentRecord.countDocuments({ status: 'succeeded' }),
    PaymentRecord.countDocuments({ status: 'failed' }),
    PaymentRecord.findOne({ status: 'succeeded' }).sort({ paidAt: -1, createdAt: -1 }).select('paidAt createdAt').lean(),
    DunningState.countDocuments({ status: 'active' }),
    DunningState.countDocuments({ status: 'recovered' }),
    DunningState.countDocuments({ status: 'suspended' }),
    Auction.countDocuments({ state: 'scheduled' }),
    Auction.countDocuments({ state: 'live' }),
    Auction.countDocuments({ state: 'paused' }),
    Auction.countDocuments({ state: 'closed' }),
    Transaction.countDocuments(),
    InvoiceDraft.countDocuments(),
    InvoiceQueue.countDocuments(),
    InvoiceQueue.countDocuments({ status: 'queued' }),
    FiscalProfile.countDocuments(),
    Conversation.countDocuments(),
    Message.countDocuments(),
    Conversation.countDocuments({ status: 'active' }),
    Conversation.countDocuments({ status: 'archived' }),
    Conversation.countDocuments({ status: 'closed' }),
    ConversationParticipant.distinct('conversationId', { unreadCount: { $gt: 0 } }),
    Audit.countDocuments({ action: { $in: alertActionNames } }),
  ]);

  const membershipsHealth: HealthStatus = suspended > 0 || inDunning > 0 ? 'warning' : 'healthy';
  const paymentsHealth: HealthStatus = failedPayments > 0 ? 'warning' : 'healthy';
  const dunningHealth: HealthStatus = suspendedCases > 0 ? 'critical' : activeDunningCases > 0 ? 'warning' : 'healthy';
  const fiscalHealth: HealthStatus = invoiceQueuePending > 0 ? 'warning' : 'healthy';
  const alertsHealth: HealthStatus = await Audit.exists({ action: 'MEMBERSHIP_HIGH_PAYMENT_FAILURE_RATE' })
    ? 'critical'
    : unresolvedAlerts > 0
      ? 'warning'
      : 'healthy';

  const alerts = await getAdminControlCenterAlerts(10);

  return {
    generatedAt: new Date().toISOString(),
    systemHealth: {
      overall: mergeHealth(membershipsHealth, paymentsHealth, dunningHealth, fiscalHealth, alertsHealth),
      usersModule: 'healthy' as HealthStatus,
      membershipsModule: membershipsHealth,
      paymentsModule: paymentsHealth,
      dunningModule: dunningHealth,
      auctionsModule: 'healthy' as HealthStatus,
      fiscalModule: fiscalHealth,
    },
    pendingActions: {
      dunningCases: activeDunningCases,
      cancellationsScheduled,
      invoiceQueuePending,
      failedPayments,
      unresolvedAlerts,
    },
    users: {
      totalUsers,
      activeUsers: totalUsers,
      suspendedUsers: 0,
      admins,
      newUsersLast30Days,
    },
    memberships: {
      activeMemberships,
      freeMemberships,
      paidMemberships,
      gracePeriod,
      inDunning,
      suspended,
      cancellationsScheduled,
    },
    catalog: {
      totalAnimals,
      activeListings,
      soldListings,
      archivedListings,
      featuredListings,
    },
    payments: {
      checkoutSessions,
      paymentRecords,
      successfulPayments,
      failedPayments,
      lastPaymentDate: isoDate(lastPayment?.paidAt ?? lastPayment?.createdAt),
    },
    dunning: {
      activeDunningCases,
      gracePeriodCases: gracePeriod,
      recoveredCases,
      suspendedCases,
    },
    auctions: {
      scheduled: scheduledAuctions,
      live: liveAuctions,
      paused: pausedAuctions,
      closed: closedAuctions,
      cancelled: 0,
    },
    fiscal: {
      transactions,
      invoiceDrafts,
      invoiceQueue,
      fiscalProfiles,
    },
    messaging: {
      conversationsTotal,
      messagesTotal,
      activeConversations,
      archivedConversations,
      closedConversations,
      averageMessagesPerConversation: conversationsTotal > 0 ? messagesTotal / conversationsTotal : 0,
      conversationsWithUnreadMessages: conversationsWithUnreadMessages.length,
    },
    alerts,
  };
}

export async function getAdminControlCenterActivity(limit = 25) {
  const safeLimit = normalizeAdminLimit(limit, 25, 100);
  const [audits, notifications, membershipChanges, paymentWebhooks] = await Promise.all([
    Audit.find().sort({ createdAt: -1 }).limit(safeLimit).select('_id action createdAt actor').lean(),
    Notification.find().sort({ createdAt: -1 }).limit(safeLimit).select('_id type title read createdAt').lean(),
    MembershipChangeLog.find().sort({ createdAt: -1 }).limit(safeLimit).select('_id changeType source effectiveAt createdAt').lean(),
    PaymentWebhookLog.find().sort({ createdAt: -1 }).limit(safeLimit).select('_id eventType processed attempts createdAt').lean(),
  ]);

  const items: Array<{
    id: string;
    type: ActivityType;
    createdAt: string;
    title: string;
    description: string;
  }> = [
    ...audits.map((audit) => ({
      id: String(audit._id),
      type: 'audit' as ActivityType,
      createdAt: isoDate(audit.createdAt) ?? new Date(0).toISOString(),
      title: audit.action,
      description: `Audit event ${audit.action}`,
    })),
    ...notifications.map((notification) => ({
      id: String(notification._id),
      type: 'notification' as ActivityType,
      createdAt: isoDate((notification as any).createdAt) ?? new Date(0).toISOString(),
      title: notification.title,
      description: `Notification ${notification.type}`,
    })),
    ...membershipChanges.map((change) => ({
      id: String(change._id),
      type: 'membership_change' as ActivityType,
      createdAt: isoDate(change.createdAt) ?? new Date(0).toISOString(),
      title: change.changeType,
      description: `Membership change from ${change.source}`,
    })),
    ...paymentWebhooks.map((webhook) => ({
      id: String(webhook._id),
      type: 'payment_webhook' as ActivityType,
      createdAt: isoDate(webhook.createdAt) ?? new Date(0).toISOString(),
      title: webhook.eventType,
      description: webhook.processed ? 'Payment webhook processed' : 'Payment webhook pending',
    })),
  ];

  return items
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, safeLimit);
}

export async function getAdminControlCenterAlerts(limit = 25) {
  const safeLimit = normalizeAdminLimit(limit, 25, 100);
  const events = await Audit.find({ action: { $in: alertActionNames } })
    .sort({ createdAt: -1 })
    .limit(Math.max(safeLimit * 3, 20))
    .select('_id action createdAt')
    .lean();

  const seen = new Set<string>();
  return events
    .filter((event) => {
      if (seen.has(event.action)) return false;
      seen.add(event.action);
      return true;
    })
    .slice(0, safeLimit)
    .map((event) => {
      const config = adminControlCenterAlertActions[event.action as keyof typeof adminControlCenterAlertActions];
      return {
        id: String(event._id),
        code: event.action,
        severity: config.severity,
        description: config.description,
        createdAt: isoDate(event.createdAt),
      };
    });
}
