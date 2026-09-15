import { Media } from '../media/media.model';
import { MembershipPlan } from './membershipPlan.model';
import { UserMembership, operationallyActiveMembershipStatuses } from './userMembership.model';
import { ensureDefaultMembershipPlans } from './membership.seed';

/** Photo checks must not assign membership or initialize usage while saving drafts. */
export async function listingPhotosAllowed(userId: string, mediaIds: string[]) {
  const membership = await UserMembership.findOne({ userId, status: { $in: operationallyActiveMembershipStatuses } }).sort({ createdAt: -1 })
    || await UserMembership.findOne({ userId }).sort({ createdAt: -1 });
  const plan = membership ? await MembershipPlan.findById(membership.planId) : await ensureDefaultMembershipPlans();
  const photos = await Media.countDocuments({ _id: { $in: mediaIds }, owner: userId, kind: 'image' });
  return photos <= (plan?.benefits.maxPhotosPerListing ?? 0);
}
