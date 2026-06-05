# Stripe Live Rollback Plan

## Purpose

This plan documents how to respond if Stripe Live activation causes an incident in a future approved sprint.

This document does not activate Stripe Live.

## Primary Deactivation

Set:

```text
STRIPE_ENABLED=false
```

Expected effect:

- New checkout requests should be blocked.
- Existing webhook processing may still receive events and must be monitored.

## Configuration Rollback

Steps:

1. Disable checkout through STRIPE_ENABLED=false.
2. Confirm Render environment updated.
3. Redeploy or restart service if required by Render.
4. Confirm /account/membership/checkout no longer creates live checkout.
5. Preserve all logs and database records.
6. Do not delete PaymentRecord or PaymentWebhookLog records.

## Webhook Failing

Detection:

- Stripe dashboard shows delivery failures.
- PaymentWebhookLog missing expected events.
- Users report payment not reflected.

Response:

- Keep webhook endpoint available if safe.
- Fix endpoint/config issue.
- Replay webhook from Stripe dashboard only after issue is understood.
- Monitor PaymentWebhookLog and PaymentRecord.

## Payment Inconsistent

Detection:

- Stripe shows payment succeeded.
- PaymentRecord missing or failed.
- UserMembership not active.

Response:

- Collect Stripe event id and invoice id.
- Review PaymentWebhookLog providerEventId and payloadHash.
- Review PaymentCheckoutSession metadata.
- Review PaymentRecord.
- Escalate before manual activation.

## Erroneous Membership Activation

Detection:

- UserMembership upgraded without reliable invoice.paid.
- PaymentRecord not succeeded.
- Audit timeline inconsistent.

Response:

- Disable checkout if systemic.
- Preserve records.
- Review MembershipChangeLog and Audit.
- Do not delete records.
- Apply correction only with explicit approval and evidence.

## Checkout Available But Webhook Down

Response:

1. Disable checkout.
2. Notify support.
3. Identify affected checkout sessions.
4. Compare Stripe dashboard with PaymentCheckoutSession.
5. Replay verified webhooks after fix.
6. Confirm memberships activate only from invoice.paid.

## Internal Communication

Notify:

- Executive owner.
- Backend operator.
- Payment operations owner.
- Support owner.

Message should include:

- Incident type.
- Current impact.
- Whether checkout is disabled.
- Known affected users.
- Next action owner.

Do not include secrets, live keys, raw webhook payloads, or card data.

## Evidence To Preserve

- PaymentWebhookLog.
- PaymentRecord.
- PaymentCheckoutSession.
- PaymentCustomer.
- UserMembership.
- MembershipChangeLog.
- DunningState.
- Notification.
- Audit.
- Render logs.
- Stripe dashboard event references.

## Recovery Completion

Rollback is complete when:

- Checkout is disabled or stable.
- Affected payments are reconciled.
- Membership states are correct.
- Users are informed if needed.
- Incident notes are documented.
- Preventive action is assigned.
