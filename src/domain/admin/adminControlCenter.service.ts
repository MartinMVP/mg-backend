import { Audit } from '../audit/audit.model';
import { Animal } from '../animals/animal.model';
import { AuctionBid } from '../auctionListings/auctionBid.model';
import { AuctionListing } from '../auctionListings/auctionListing.model';
import { AuctionCloseOutcome } from '../auctionOperations/auctionCloseOutcome.model';
import { AuctionDefaultReport } from '../auctionDefaults/auctionDefault.model';
import { AuctionSanction } from '../auctionSanctions/auctionSanction.model';
import { AuctionAppeal } from '../auctionAppeals/auctionAppeal.model';
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
import { PlatformConfiguration } from '../platformConfiguration/platformConfiguration.model';
import { AOECase } from '../aoe/aoeCase.model';
import { AOEDecisionProposal } from '../aoe/aoeDecisionProposal.model';
import { AOEOperationalDecisionPackage } from '../aoeOperationalDecisions/aoeOperationalDecision.model';
import { AnalyticsEvent } from '../analytics/analyticsEvent.model';
import { getAnalyticsQualityTrend, getAnalyticsReadiness } from '../analytics/analyticsQuality.service';
import { KnowledgeRecord } from '../knowledge/knowledgeRecord.model';
import { KnowledgeRegistry } from '../knowledge/knowledgeRegistry.model';
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
    auctionListingsTotal,
    activeAuctionListings,
    closedAuctionListings,
    cancelledAuctionListings,
    auctionListingBidsTotal,
    completedAuctionCloseOutcomes,
    notCompletedAuctionCloseOutcomes,
    sellerUnresponsiveReports,
    auctionDefaultsTotal,
    auctionDefaultsPending,
    auctionDefaultsConfirmed,
    auctionDefaultsRejected,
    activeAuctionSanctions,
    expiredAuctionSanctions,
    permanentAuctionSanctions,
    requestedAuctionAppeals,
    underReviewAuctionAppeals,
    approvedAuctionAppeals,
    rejectedAuctionAppeals,
    totalPlatformConfigurations,
    activePlatformConfigurations,
    sandboxPlatformConfigurations,
    productionPlatformConfigurations,
    openAOECases,
    collectingEvidenceAOECases,
    proposalGeneratedAOECases,
    escalatedAOECases,
    closedAOECases,
    lowPriorityAOECases,
    mediumPriorityAOECases,
    highPriorityAOECases,
    criticalPriorityAOECases,
    generatedAOEProposals,
    viewedAOEProposals,
    escalatedAOEProposals,
    closedAOEProposals,
    totalGeneratedAOEOperationalDecisions,
    viewedAOEOperationalDecisions,
    escalatedAOEOperationalDecisions,
    closedAOEOperationalDecisions,
    lowRiskAOEOperationalDecisions,
    mediumRiskAOEOperationalDecisions,
    highRiskAOEOperationalDecisions,
    criticalRiskAOEOperationalDecisions,
    averageAOEOperationalDecisionConfidence,
    degradedModeAOEOperationalDecisions,
    totalAnalyticsEvents,
    operationalAnalyticsEvents,
    businessAnalyticsEvents,
    analyticsEventsLast24h,
    analyticsEventsLast7d,
    topAnalyticsDomains,
    topAnalyticsEventTypes,
    totalKnowledgeRecords,
    totalKnowledgeRegistryEntries,
    recordsByKnowledgeDomain,
    recordsByKnowledgeSourceType,
    latestVersionedKnowledgeRecords,
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
    AuctionListing.countDocuments(),
    AuctionListing.countDocuments({ status: 'active' }),
    AuctionListing.countDocuments({ status: 'closed' }),
    AuctionListing.countDocuments({ status: 'cancelled' }),
    AuctionBid.countDocuments(),
    AuctionCloseOutcome.countDocuments({ outcome: 'completed' }),
    AuctionCloseOutcome.countDocuments({ outcome: 'not_completed' }),
    AuctionCloseOutcome.countDocuments({ outcome: 'seller_unresponsive' }),
    AuctionDefaultReport.countDocuments(),
    AuctionDefaultReport.countDocuments({ status: 'pending' }),
    AuctionDefaultReport.countDocuments({ status: 'confirmed' }),
    AuctionDefaultReport.countDocuments({ status: 'rejected' }),
    AuctionSanction.countDocuments({ status: 'active' }),
    AuctionSanction.countDocuments({ status: 'expired' }),
    AuctionSanction.countDocuments({ status: 'active', $or: [{ endsAt: { $exists: false } }, { endsAt: null }] }),
    AuctionAppeal.countDocuments({ status: 'requested' }),
    AuctionAppeal.countDocuments({ status: 'under_review' }),
    AuctionAppeal.countDocuments({ status: 'approved' }),
    AuctionAppeal.countDocuments({ status: 'rejected' }),
    PlatformConfiguration.countDocuments(),
    PlatformConfiguration.countDocuments({ isActive: true }),
    PlatformConfiguration.countDocuments({ environment: 'sandbox' }),
    PlatformConfiguration.countDocuments({ environment: 'production' }),
    AOECase.countDocuments({ status: 'open' }),
    AOECase.countDocuments({ status: 'collecting_evidence' }),
    AOECase.countDocuments({ status: 'proposal_generated' }),
    AOECase.countDocuments({ status: 'escalated' }),
    AOECase.countDocuments({ status: 'closed' }),
    AOECase.countDocuments({ priority: 'low' }),
    AOECase.countDocuments({ priority: 'medium' }),
    AOECase.countDocuments({ priority: 'high' }),
    AOECase.countDocuments({ priority: 'critical' }),
    AOEDecisionProposal.countDocuments({ status: 'generated' }),
    AOEDecisionProposal.countDocuments({ status: 'viewed' }),
    AOEDecisionProposal.countDocuments({ status: 'escalated' }),
    AOEDecisionProposal.countDocuments({ status: 'closed' }),
    AOEOperationalDecisionPackage.countDocuments(),
    AOEOperationalDecisionPackage.countDocuments({ status: 'viewed' }),
    AOEOperationalDecisionPackage.countDocuments({ status: 'escalated' }),
    AOEOperationalDecisionPackage.countDocuments({ status: 'closed' }),
    AOEOperationalDecisionPackage.countDocuments({ riskLevel: 'low' }),
    AOEOperationalDecisionPackage.countDocuments({ riskLevel: 'medium' }),
    AOEOperationalDecisionPackage.countDocuments({ riskLevel: 'high' }),
    AOEOperationalDecisionPackage.countDocuments({ riskLevel: 'critical' }),
    AOEOperationalDecisionPackage.aggregate<{ _id: null; averageConfidence: number }>([
      { $group: { _id: null, averageConfidence: { $avg: '$confidence.overall' } } },
    ]),
    AOEOperationalDecisionPackage.countDocuments({ 'qualitySummary.recommendedMode': { $ne: 'normal' } }),
    AnalyticsEvent.countDocuments(),
    AnalyticsEvent.countDocuments({ analyticsCategory: 'operational' }),
    AnalyticsEvent.countDocuments({ analyticsCategory: 'business' }),
    AnalyticsEvent.countDocuments({ occurredAt: { $gte: new Date(Date.now() - 24 * 60 * 60_000) } }),
    AnalyticsEvent.countDocuments({ occurredAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60_000) } }),
    AnalyticsEvent.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$domain', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
    AnalyticsEvent.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$eventType', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 },
    ]),
    KnowledgeRecord.countDocuments(),
    KnowledgeRegistry.countDocuments(),
    KnowledgeRecord.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$knowledgeDomain', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    KnowledgeRecord.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$sourceType', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    KnowledgeRecord.find({ version: { $gt: 1 } })
      .sort({ createdAt: -1 })
      .limit(10)
      .select('_id knowledgeDomain knowledgeType version createdAt')
      .lean(),    Audit.countDocuments({ action: { $in: alertActionNames } }),
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
  const analyticsQualityReadiness = await getAnalyticsReadiness();
  const analyticsQualityTrend = await getAnalyticsQualityTrend(analyticsQualityReadiness.overallScore);

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
    auctionListings: {
      total: auctionListingsTotal,
      active: activeAuctionListings,
      closed: closedAuctionListings,
      cancelled: cancelledAuctionListings,
      bidsTotal: auctionListingBidsTotal,
    },
    auctionOperations: {
      completedOutcomes: completedAuctionCloseOutcomes,
      notCompletedOutcomes: notCompletedAuctionCloseOutcomes,
      sellerUnresponsiveReports,
    },
    auctionDefaults: {
      total: auctionDefaultsTotal,
      pending: auctionDefaultsPending,
      confirmed: auctionDefaultsConfirmed,
      rejected: auctionDefaultsRejected,
    },
    auctionSanctions: {
      active: activeAuctionSanctions,
      expired: expiredAuctionSanctions,
      permanent: permanentAuctionSanctions,
    },
    auctionAppeals: {
      requested: requestedAuctionAppeals,
      underReview: underReviewAuctionAppeals,
      approved: approvedAuctionAppeals,
      rejected: rejectedAuctionAppeals,
    },
    configurationCenter: {
      totalConfigs: totalPlatformConfigurations,
      activeConfigs: activePlatformConfigurations,
      sandboxConfigs: sandboxPlatformConfigurations,
      productionConfigs: productionPlatformConfigurations,
    },
    aoe: {
      openCases: openAOECases,
      collectingEvidenceCases: collectingEvidenceAOECases,
      proposalGeneratedCases: proposalGeneratedAOECases,
      escalatedCases: escalatedAOECases,
      closedCases: closedAOECases,
      lowPriority: lowPriorityAOECases,
      mediumPriority: mediumPriorityAOECases,
      highPriority: highPriorityAOECases,
      criticalPriority: criticalPriorityAOECases,
      generatedProposals: generatedAOEProposals,
      viewedProposals: viewedAOEProposals,
      escalatedProposals: escalatedAOEProposals,
      closedProposals: closedAOEProposals,
    },
    aoeOperationalDecisions: {
      totalGenerated: totalGeneratedAOEOperationalDecisions,
      viewed: viewedAOEOperationalDecisions,
      escalated: escalatedAOEOperationalDecisions,
      closed: closedAOEOperationalDecisions,
      lowRisk: lowRiskAOEOperationalDecisions,
      mediumRisk: mediumRiskAOEOperationalDecisions,
      highRisk: highRiskAOEOperationalDecisions,
      criticalRisk: criticalRiskAOEOperationalDecisions,
      averageConfidence: averageAOEOperationalDecisionConfidence[0]?.averageConfidence || 0,
      degradedModeUsage: degradedModeAOEOperationalDecisions,
    },
    analytics: {
      totalEvents: totalAnalyticsEvents,
      operationalEvents: operationalAnalyticsEvents,
      businessEvents: businessAnalyticsEvents,
      eventsLast24h: analyticsEventsLast24h,
      eventsLast7d: analyticsEventsLast7d,
      topDomains: topAnalyticsDomains.map((item) => ({ domain: item._id, count: item.count })),
      topEventTypes: topAnalyticsEventTypes.map((item) => ({ eventType: item._id, count: item.count })),
    },
    knowledgeFoundation: {
      totalRecords: totalKnowledgeRecords,
      totalRegistryEntries: totalKnowledgeRegistryEntries,
      recordsByDomain: recordsByKnowledgeDomain.map((item) => ({ domain: item._id, count: item.count })),
      recordsBySourceType: recordsByKnowledgeSourceType.map((item) => ({ sourceType: item._id, count: item.count })),
      latestVersionedRecords: latestVersionedKnowledgeRecords.map((record) => ({
        id: String(record._id),
        knowledgeDomain: record.knowledgeDomain,
        knowledgeType: record.knowledgeType,
        version: record.version,
        createdAt: isoDate(record.createdAt),
      })),
    },
    analyticsQuality: {
      score: analyticsQualityReadiness.overallScore,
      classification: analyticsQualityReadiness.classification,
      health: analyticsQualityReadiness.health,
      coverage: analyticsQualityReadiness.coverage.overall,
      correlation: analyticsQualityReadiness.correlation.correlationCoverage,
      integrity: analyticsQualityReadiness.integrity.score,
      completeness: analyticsQualityReadiness.completeness.completenessScore,
      freshness: analyticsQualityReadiness.freshness.status,
      latency: {
        avgLatencyMs: analyticsQualityReadiness.latency.avgLatencyMs,
        p95LatencyMs: analyticsQualityReadiness.latency.p95LatencyMs,
        maxLatencyMs: analyticsQualityReadiness.latency.maxLatencyMs,
        sampleSize: analyticsQualityReadiness.latency.sampleSize,
      },
      trend: analyticsQualityTrend.trend,
      blockingIssues: analyticsQualityReadiness.blockingIssues,
      warnings: analyticsQualityReadiness.warnings,
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








