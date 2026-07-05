import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { MembershipBenefit } from '../../domain/memberships/membershipBenefit.model';
import {
  consumeMembershipBenefit,
  releaseMembershipBenefit,
  validateMembershipBenefit,
} from '../../domain/memberships/membershipFoundation.service';
import { MembershipHistory } from '../../domain/memberships/membershipHistory.model';
import { MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { Notification } from '../../domain/notifications/notification.model';
import { bearer } from '../../test/helpers/auth';
import { signAccessToken } from '../../utils/jwt';
import { createTestUser } from '../../test/helpers/factories';

function professionalPlanPayload(overrides: Record<string, unknown> = {}) {
  return {
    code: `professional-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: 'Professional',
    description: 'Professional membership foundation plan',
    monthlyPrice: 1500,
    yearlyPrice: 15000,
    durationDays: 30,
    limits: {
      animalListings: 25,
      auctionListings: 10,
      mediaUploads: 100,
      messaging: 500,
      featuredPublications: 5,
    },
    benefits: {
      maxActiveListings: 25,
      maxPhotosPerListing: 20,
      canUseFeaturedListings: true,
      includedFeaturedListings: 5,
      canAccessAuctions: true,
      canAccessMetrics: false,
      supportLevel: 'priority',
    },
    isActive: true,
    isPublic: false,
    ...overrides,
  };
}

async function adminToken(role: 'admin' | 'super' = 'admin') {
  const user = await createTestUser(role);
  return { user, token: signAccessToken({ sub: String(user._id), role, typ: 'access' }) };
}

describe('membership foundation 13.2A', () => {
  it('lets admin operate a Professional plan and full manual membership lifecycle', async () => {
    const { token, user: admin } = await adminToken('admin');
    const member = await createTestUser('user');

    const createdPlan = await request(app)
      .post('/membership/plans')
      .set('Authorization', bearer(token))
      .send(professionalPlanPayload())
      .expect(201);

    expect(createdPlan.body.name).toBe('Professional');
    expect(createdPlan.body.monthlyPrice).toBe(1500);
    expect(createdPlan.body.durationDays).toBe(30);

    const updatedPlan = await request(app)
      .patch(`/membership/plans/${createdPlan.body._id}`)
      .set('Authorization', bearer(token))
      .send({ name: 'Professional Plus', monthlyPrice: 1700 })
      .expect(200);

    expect(updatedPlan.body.name).toBe('Professional Plus');
    expect(updatedPlan.body.price).toBe(1700);

    const createdMembership = await request(app)
      .post('/memberships')
      .set('Authorization', bearer(token))
      .send({ userId: String(member._id), planId: createdPlan.body._id, metadata: { channel: 'admin' } })
      .expect(201);

    expect(createdMembership.body.status).toBe('pending_activation');

    const activated = await request(app)
      .patch(`/memberships/${createdMembership.body._id}/activate`)
      .set('Authorization', bearer(token))
      .expect(200);

    expect(activated.body.status).toBe('active');
    expect(await MembershipBenefit.countDocuments({ membershipId: activated.body._id })).toBe(5);

    const suspended = await request(app)
      .patch(`/memberships/${createdMembership.body._id}/suspend`)
      .set('Authorization', bearer(token))
      .expect(200);

    expect(suspended.body.status).toBe('suspended');

    const reactivated = await request(app)
      .patch(`/memberships/${createdMembership.body._id}/reactivate`)
      .set('Authorization', bearer(token))
      .expect(200);

    expect(reactivated.body.status).toBe('active');

    const expired = await request(app)
      .patch(`/memberships/${createdMembership.body._id}/expire`)
      .set('Authorization', bearer(token))
      .expect(200);

    expect(expired.body.status).toBe('expired');

    const cancelled = await request(app)
      .patch(`/memberships/${createdMembership.body._id}/cancel`)
      .set('Authorization', bearer(token))
      .expect(200);

    expect(cancelled.body.status).toBe('cancelled');

    const history = await request(app)
      .get(`/memberships/${createdMembership.body._id}/history`)
      .set('Authorization', bearer(token))
      .expect(200);

    expect(history.body.items.map((item: any) => item.action)).toEqual(
      expect.arrayContaining(['created', 'activated', 'suspended', 'expired', 'cancelled'])
    );

    await request(app).get('/membership/plans').set('Authorization', bearer(token)).expect(200);
    await request(app).get('/memberships').set('Authorization', bearer(token)).expect(200);
    await request(app).get(`/memberships/${createdMembership.body._id}`).set('Authorization', bearer(token)).expect(200);

    expect(await Audit.exists({ actor: String(admin._id), action: 'MEMBERSHIP_PLAN_CREATED' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(admin._id), action: 'MEMBERSHIP_PLAN_UPDATED' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(admin._id), action: 'MEMBERSHIP_CREATED' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(admin._id), action: 'MEMBERSHIP_ACTIVATED' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(admin._id), action: 'MEMBERSHIP_SUSPENDED' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(admin._id), action: 'MEMBERSHIP_EXPIRED' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(admin._id), action: 'MEMBERSHIP_CANCELLED' })).toBeTruthy();

    expect(await Notification.exists({ userId: member._id, type: 'membership_created' })).toBeTruthy();
    expect(await Notification.exists({ userId: member._id, type: 'membership_activated' })).toBeTruthy();
    expect(await Notification.exists({ userId: member._id, type: 'membership_suspended' })).toBeTruthy();
    expect(await Notification.exists({ userId: member._id, type: 'membership_expired' })).toBeTruthy();
  });

  it('supports benefit grant, consume, release, expire and validate operations', async () => {
    const { token, user: admin } = await adminToken('admin');
    const member = await createTestUser('user');
    const plan = await request(app).post('/membership/plans').set('Authorization', bearer(token)).send(professionalPlanPayload()).expect(201);
    const membership = await request(app).post('/memberships').set('Authorization', bearer(token)).send({ userId: String(member._id), planId: plan.body._id }).expect(201);
    await request(app).patch(`/memberships/${membership.body._id}/activate`).set('Authorization', bearer(token)).expect(200);

    const consumed = await consumeMembershipBenefit(membership.body._id, 'animal_listings', 2, String(admin._id));
    expect(consumed.consumed).toBe(2);
    expect(await validateMembershipBenefit(membership.body._id, 'animal_listings')).toMatchObject({ allowed: true });

    const released = await releaseMembershipBenefit(membership.body._id, 'animal_listings', 1);
    expect(released.consumed).toBe(1);

    await request(app).patch(`/memberships/${membership.body._id}/expire`).set('Authorization', bearer(token)).expect(200);
    const validation = await validateMembershipBenefit(membership.body._id, 'animal_listings');
    expect(validation.allowed).toBe(false);
    expect(await Audit.exists({ actor: String(admin._id), action: 'BENEFIT_GRANTED' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(admin._id), action: 'BENEFIT_CONSUMED' })).toBeTruthy();
  });

  it('protects administration routes from unauthenticated and non-admin users', async () => {
    await request(app).post('/membership/plans').send(professionalPlanPayload()).expect(401);

    const user = await createTestUser('user');
    const token = signAccessToken({ sub: String(user._id), role: 'user', typ: 'access' });

    await request(app)
      .post('/membership/plans')
      .set('Authorization', bearer(token))
      .send(professionalPlanPayload())
      .expect(403);
  });

  it('keeps Membership Free compatible', async () => {
    const user = await createTestUser('user');
    const token = signAccessToken({ sub: String(user._id), role: 'user', typ: 'access' });

    const res = await request(app)
      .get('/account/membership')
      .set('Authorization', bearer(token))
      .expect(200);

    expect(res.body.plan.code).toBe('free');
    expect(res.body.membership.status).toBe('active');
  });

  it('exposes membershipFoundation metrics in Admin Control Center', async () => {
    const { token } = await adminToken('admin');
    const member = await createTestUser('user');
    const plan = await request(app).post('/membership/plans').set('Authorization', bearer(token)).send(professionalPlanPayload()).expect(201);
    const membership = await request(app).post('/memberships').set('Authorization', bearer(token)).send({ userId: String(member._id), planId: plan.body._id }).expect(201);
    await request(app).patch(`/memberships/${membership.body._id}/activate`).set('Authorization', bearer(token)).expect(200);

    const res = await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(token))
      .expect(200);

    expect(res.body.membershipFoundation.plans).toBeGreaterThanOrEqual(1);
    expect(res.body.membershipFoundation.memberships).toBeGreaterThanOrEqual(1);
    expect(res.body.membershipFoundation.activeMemberships).toBeGreaterThanOrEqual(1);
    expect(res.body.membershipFoundation.benefitsGranted).toBeGreaterThanOrEqual(5);
  });
});

