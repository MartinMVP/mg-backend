import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { Audit } from '../../domain/audit/audit.model';
import * as analyticsRepository from '../../domain/analytics/analyticsEvent.repository';
import { AnalyticsEvent } from '../../domain/analytics/analyticsEvent.model';
import { getAnalyticsSummary } from '../../domain/analytics/analyticsAggregation.service';
import {
  getBusinessAnalytics,
  getEventsByCorrelationId,
  getOperationalAnalytics,
} from '../../domain/analytics/analyticsQuery.service';
import {
  analyticsAuditActions,
  getAnalyticsContextForEntity,
  recordAnalyticsEvent,
} from '../../domain/analytics/analytics.service';
import {
  getConfigValue,
  seedSandboxDefaultConfigurations,
} from '../../domain/platformConfiguration/platformConfiguration.service';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createTestUser } from '../../test/helpers/factories';

let app: typeof import('../../app').default;

describe('Analytics backbone', () => {
  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  it('creates normalized append-only Analytics Events with dimensions, tags and trace context', async () => {
    const actor = await createTestUser('user');
    const entityId = new Types.ObjectId();
    const event = await recordAnalyticsEvent({
      domain: 'auction_listings',
      eventType: 'BID_PLACED',
      entityType: 'auction',
      entityId,
      actorId: actor._id,
      metadata: { amount: 100_000 },
      dimensions: {
        country: 'MX',
        state: 'Sonora',
        municipality: 'Hermosillo',
        species: 'bovine',
        breed: 'Brangus',
        auctionType: 'commercial',
        channel: 'web',
        device: 'desktop',
        environment: 'sandbox',
      },
      tags: ['Auction', 'auction', 'marketplace'],
      correlationId: 'corr-auction-1',
      sessionId: 'session-1',
      requestId: 'request-1',
      source: 'domain_event',
    });

    expect(event.analyticsCategory).toBe('business');
    expect(event.dimensions.state).toBe('Sonora');
    expect(event.tags).toEqual(['auction', 'marketplace']);
    expect(event.correlationId).toBe('corr-auction-1');
    expect(event.sessionId).toBe('session-1');
    expect(event.requestId).toBe('request-1');
    await expect(AnalyticsEvent.updateOne({ _id: event._id }, { $set: { eventType: 'CHANGED' } }))
      .rejects.toThrow('analytics_event_append_only');
    await expect(AnalyticsEvent.deleteOne({ _id: event._id })).rejects.toThrow('analytics_event_append_only');
  });

  it('keeps repository write surface limited to create, find, list, count and aggregate', () => {
    expect(Object.keys(analyticsRepository).sort()).toEqual([
      'aggregateAnalyticsEvents',
      'countAnalyticsEvents',
      'createAnalyticsEvent',
      'findAnalyticsEvent',
      'listAnalyticsEvents',
    ]);
  });

  it('summarizes and queries operational, business and correlation analytics', async () => {
    await recordAnalyticsEvent({
      domain: 'aoe',
      eventType: 'AOE_CASE_CREATED',
      entityType: 'platform',
      entityId: new Types.ObjectId(),
      tags: ['aoe', 'system'],
      correlationId: 'corr-shared',
      source: 'aoe',
    });
    await recordAnalyticsEvent({
      domain: 'membership',
      eventType: 'MEMBERSHIP_ACTIVATED',
      entityType: 'membership',
      entityId: new Types.ObjectId(),
      tags: ['membership', 'premium'],
      dimensions: { membershipPlan: 'business', environment: 'sandbox' },
      correlationId: 'corr-shared',
    });

    const summary = await getAnalyticsSummary();
    expect(summary.totalEvents).toBe(2);
    expect(summary.eventsByCategory).toEqual(expect.arrayContaining([
      { category: 'operational', count: 1 },
      { category: 'business', count: 1 },
    ]));
    expect(summary.eventsLast24h).toBe(2);
    expect(summary.eventsLast7d).toBe(2);

    await expect(getOperationalAnalytics()).resolves.toMatchObject({ total: 1 });
    await expect(getBusinessAnalytics()).resolves.toMatchObject({ total: 1 });
    await expect(getEventsByCorrelationId('corr-shared')).resolves.toMatchObject({ total: 2 });
  });

  it('exposes Analytics context for AOE without executing decisions', async () => {
    const entityId = new Types.ObjectId();
    await recordAnalyticsEvent({
      domain: 'auction_listings',
      eventType: 'AUCTION_DEFAULT_CONFIRMED',
      entityType: 'auction',
      entityId,
      tags: ['auction', 'sanction'],
      correlationId: 'corr-context',
    });

    const context = await getAnalyticsContextForEntity('auction', entityId);
    expect(context.totalEvents).toBe(1);
    expect(context.tags).toEqual(expect.arrayContaining([{ tag: 'auction', count: 1 }]));
    expect(context.domains).toEqual(expect.arrayContaining([{ domain: 'auction_listings', count: 1 }]));
    expect(context.correlationIds).toEqual(['corr-context']);
  });

  it('includes retention policy in PCC sandbox defaults', async () => {
    const superUser = await createTestUser('super');
    await seedSandboxDefaultConfigurations(superUser._id);
    await expect(getConfigValue('analytics.rawRetentionYears', 'sandbox')).resolves.toBe(5);
    await expect(getConfigValue('analytics.aggregationRetentionPolicy', 'sandbox')).resolves.toBe('indefinite');
  });

  it('protects admin endpoints and returns minimal analytics views', async () => {
    const admin = await createTestUser('admin');
    const user = await createTestUser('user');
    await recordAnalyticsEvent({
      domain: 'messaging',
      eventType: 'MESSAGE_SENT',
      entityType: 'conversation',
      entityId: new Types.ObjectId(),
      tags: ['messaging'],
      correlationId: 'corr-admin',
    });

    await request(app).get('/admin/analytics/summary').expect(401);
    await request(app)
      .get('/admin/analytics/summary')
      .set('Authorization', bearer(createAccessToken(user._id, 'user')))
      .expect(403);
    await request(app)
      .get('/admin/analytics/summary')
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .expect(200)
      .expect((res) => {
        expect(res.body.totalEvents).toBe(1);
      });
    await request(app)
      .get('/admin/analytics/events?domain=messaging&limit=10')
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .expect(200)
      .expect((res) => {
        expect(res.body.total).toBe(1);
      });
    await request(app)
      .get('/admin/analytics/events/correlation/corr-admin')
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .expect(200)
      .expect((res) => {
        expect(res.body.total).toBe(1);
      });
    await request(app)
      .get('/admin/analytics/operational')
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .expect(200)
      .expect((res) => {
        expect(res.body.total).toBe(1);
      });
    await request(app)
      .get('/admin/analytics/business')
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .expect(200)
      .expect((res) => {
        expect(res.body.total).toBe(0);
      });
    expect(await Audit.exists({ action: analyticsAuditActions.summaryViewed })).toBeTruthy();
    expect(await Audit.exists({ action: analyticsAuditActions.correlationViewed })).toBeTruthy();
  });

  it('adds aggregated Analytics metrics to Admin Control Center without exposing dashboards', async () => {
    const admin = await createTestUser('admin');
    await recordAnalyticsEvent({
      domain: 'revenue',
      eventType: 'PAYMENT_SUCCEEDED',
      entityType: 'payment',
      entityId: new Types.ObjectId(),
      tags: ['payment', 'revenue'],
    });

    await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(createAccessToken(admin._id, 'admin')))
      .expect(200)
      .expect((res) => {
        expect(res.body.analytics).toMatchObject({
          totalEvents: 1,
          operationalEvents: 0,
          businessEvents: 1,
          eventsLast24h: 1,
          eventsLast7d: 1,
        });
        expect(res.body.analytics.topDomains).toEqual([{ domain: 'revenue', count: 1 }]);
        expect(res.body.analytics.topEventTypes).toEqual([{ eventType: 'PAYMENT_SUCCEEDED', count: 1 }]);
      });
  });

  it('does not implement ML, scoring, reputation, prediction or autonomous execution fields', async () => {
    const event = await recordAnalyticsEvent({
      domain: 'platform',
      eventType: 'SYSTEM_SIGNAL',
      entityType: 'platform',
      entityId: new Types.ObjectId(),
      tags: ['system'],
      metadata: { signal: 'observed' },
    });
    const raw = 'toObject' in event ? event.toObject() : event;
    expect(raw).not.toHaveProperty('score');
    expect(raw).not.toHaveProperty('reputation');
    expect(raw).not.toHaveProperty('prediction');
    expect(raw).not.toHaveProperty('embedding');
    expect(raw).not.toHaveProperty('autonomousAction');
  });
});
