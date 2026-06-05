# Revenue Troubleshooting Guide

Operational draft for Enlace Ganadero revenue incidents.

## Purpose

This guide explains how to investigate revenue and membership issues using internal records.

## Evidence Sources

- UserMembership: active plan, status, period, cancellation fields.
- MembershipUsage: listing usage and period counters.
- MembershipChangeLog: upgrade, downgrade, cancellation, reactivation.
- PaymentCustomer: provider customer reference.
- PaymentCheckoutSession: checkout request and session state.
- PaymentRecord: payment status and provider references.
- PaymentWebhookLog: signed provider events and idempotency.
- DunningState: payment failure lifecycle.
- Notification: user-visible internal notices.
- Audit: administrative and system events.

## User Cannot Publish

Check:

1. UserMembership status.
2. MembershipUsage activeListingsCount.
3. Plan max active listings.
4. Whether status is suspended.
5. Listing status requested by the user.

Expected:

- Suspended blocks new publications.
- Capacity reached blocks new published listings.
- Existing listings are not removed automatically.

## User Paid But Does Not See Active Plan

Check:

1. PaymentCheckoutSession.
2. PaymentWebhookLog for invoice.paid.
3. PaymentRecord status.
4. UserMembership plan and status.
5. Audit MEMBERSHIP_PAYMENT_SUCCEEDED.

If invoice.paid is missing, do not manually activate a paid plan without escalation.

## User Suspended

Check:

1. DunningState status.
2. failedAt, graceEndsAt, nextActionAt, retrySchedule.
3. PaymentRecord failureReason.
4. Notification membership_suspended.
5. MembershipCatalogPolicy result.

## User In grace_period

Check:

1. PaymentWebhookLog for invoice.payment_failed.
2. DunningState failedAt and graceEndsAt.
3. UserMembership status.
4. Notifications for payment failed and grace period started.

## Webhook Duplicated

Check:

1. PaymentWebhookLog providerEventId.
2. payloadHash.
3. processed flag.
4. attempts.
5. PaymentRecord duplicates.

Expected:

- Duplicate providerEventId should not duplicate business effects.

## Checkout Without invoice.paid

Check:

1. PaymentCheckoutSession status.
2. checkoutRequestId.
3. providerSessionId.
4. PaymentWebhookLog events.

Expected:

- checkout.session.completed alone does not activate paid membership.
- invoice.paid is required for paid activation.

## Upgrade Requested Without Payment

Check:

1. MembershipChangeLog upgrade_requested.
2. PaymentCheckoutSession.
3. PaymentRecord.
4. UserMembership current plan.

Expected:

- Paid upgrade remains pending until invoice.paid.

## Timeline Reconstruction

Build a timeline using:

- PaymentCheckoutSession.createdAt.
- PaymentWebhookLog.createdAt and processedAt.
- PaymentRecord.paidAt or failedAt.
- MembershipChangeLog.createdAt.
- DunningState timestamps.
- Notification.createdAt.
- Audit.createdAt.
