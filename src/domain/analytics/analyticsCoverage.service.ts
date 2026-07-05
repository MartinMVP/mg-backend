import { AnalyticsEvent } from './analyticsEvent.model';
import { AnalyticsCoverage } from './analyticsQuality.types';

export const expectedAnalyticsEvents: Record<string, string[]> = {
  marketplace: ['LISTING_CREATED', 'LISTING_PUBLISHED', 'LISTING_SOLD', 'LISTING_ARCHIVED'],
  membership: ['MEMBERSHIP_ACTIVATED', 'MEMBERSHIP_SUSPENDED'],
  revenue: ['PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'DUNNING_STARTED'],
  messaging: ['CONVERSATION_CREATED', 'MESSAGE_SENT'],
  auction_listings: [
    'AUCTION_CREATED',
    'BID_PLACED',
    'AUCTION_CLOSED',
    'AUCTION_DEFAULT_CONFIRMED',
    'AUCTION_SANCTION_APPLIED',
  ],
  aoe: ['AOE_CASE_CREATED', 'AOE_DECISION_PROPOSAL_CREATED', 'AOE_CASE_ESCALATED'],
  platform: [],
  admin: [],
};

function percent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export async function getAnalyticsCoverage(): Promise<AnalyticsCoverage> {
  const domains: AnalyticsCoverage['domains'] = {};
  const scores: number[] = [];

  for (const [domain, expectedEvents] of Object.entries(expectedAnalyticsEvents)) {
    const events: Record<string, number> = {};
    if (expectedEvents.length === 0) {
      const observed = await AnalyticsEvent.countDocuments({ domain });
      const score = observed > 0 ? 100 : 100;
      domains[domain] = { overall: score, events };
      scores.push(score);
      continue;
    }

    for (const eventType of expectedEvents) {
      const observed = await AnalyticsEvent.exists({ domain, eventType });
      events[eventType] = observed ? 100 : 0;
    }
    const overall = percent(Object.values(events).reduce((sum, score) => sum + score, 0) / expectedEvents.length);
    domains[domain] = { overall, events };
    scores.push(overall);
  }

  return {
    overall: scores.length > 0 ? percent(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 100,
    domains,
  };
}
