export const membershipAuditActions = {
  planCreated: 'MEMBERSHIP_PLAN_CREATED',
  planUpdated: 'MEMBERSHIP_PLAN_UPDATED',
  created: 'MEMBERSHIP_CREATED',
  freeAssigned: 'MEMBERSHIP_FREE_ASSIGNED',
  activated: 'MEMBERSHIP_ACTIVATED',
  suspended: 'MEMBERSHIP_SUSPENDED',
  cancelled: 'MEMBERSHIP_CANCELLED',
  limitReached: 'MEMBERSHIP_LIMIT_REACHED',
  capacityConsumed: 'MEMBERSHIP_CAPACITY_CONSUMED',
  capacityReleased: 'MEMBERSHIP_CAPACITY_RELEASED',
} as const;
