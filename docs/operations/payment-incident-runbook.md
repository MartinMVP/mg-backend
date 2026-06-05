# Payment Incident Runbook

Operational draft for Enlace Ganadero payment support.

## Purpose

This runbook defines investigation steps for checkout and payment incidents.

## Checkout Failed

Review:

- PaymentCheckoutSession status.
- checkoutRequestId.
- providerEnvironment.
- last visible error returned to user.
- Audit entries for MEMBERSHIP_CHECKOUT_REQUESTED, MEMBERSHIP_CHECKOUT_CREATED, or MEMBERSHIP_CHECKOUT_FAILED.

Confirm Stripe is still sandbox-only unless production has been explicitly approved.

## Payment Not Reflected

Review:

- PaymentWebhookLog for invoice.paid.
- PaymentRecord status.
- UserMembership active plan.
- MembershipChangeLog.
- Audit.

If checkout.session.completed exists without invoice.paid, do not manually activate paid membership. Escalate.

## Duplicate Payment

Review:

- PaymentRecord unique provider payment/invoice ids.
- PaymentWebhookLog providerEventId.
- payloadHash.
- Audit timeline.
- UserMembership changes.

Do not promise refund until administrative review is complete.

## Payment Failed

Review:

- PaymentRecord failed state.
- DunningState failedAt, graceEndsAt, nextActionAt, retrySchedule.
- UserMembership status.
- Notification records.

Payment failure should move membership to grace_period first.

## Dispute

Collect:

- UserId.
- PaymentRecord.
- Provider references.
- Membership status.
- User communication.
- Timeline of relevant events.

Escalate to payment operations owner.

## Future Administrative Refund

Refunds must only be executed through an approved production runbook and authorized payment processor access.

Before refund:

- Confirm user identity.
- Confirm PaymentRecord.
- Confirm provider payment reference.
- Confirm business approval.
- Record Audit evidence.

## Evidence Sources

Use:

- PaymentRecord.
- PaymentWebhookLog.
- PaymentCheckoutSession.
- PaymentCustomer.
- UserMembership.
- MembershipChangeLog.
- DunningState.
- Notification.
- Audit.

## Prohibited Actions

Do not:

- Create manual charges.
- Retry card payments from the system.
- Use live keys without approval.
- Store card PAN/CVC.
- Expose webhook payloads or secrets.
- Generate CFDI or fiscal documents.
