# Incident Investigation Guide

Operational draft for Enlace Ganadero incident response.

## Purpose

This guide provides a standard process for investigating operational incidents.

## Incident Classification

Classify incidents as:

- P0: widespread outage, data loss, payment processing unavailable.
- P1: multiple users affected, payment or membership state inconsistent.
- P2: single user blocked, payment delayed, dunning issue.
- P3: low-impact support issue or documentation gap.

## Evidence Sources

Use:

- Application logs.
- Render deployment events.
- MongoDB records.
- UserMembership.
- MembershipUsage.
- MembershipChangeLog.
- PaymentCustomer.
- PaymentCheckoutSession.
- PaymentRecord.
- PaymentWebhookLog.
- DunningState.
- Notification.
- Audit.

## Diagnostic Steps

1. Identify affected user(s), time range, and feature.
2. Confirm whether the issue is user-specific or systemic.
3. Review recent deploys.
4. Review payment/webhook/membership records.
5. Build a timeline.
6. Identify last known correct state.
7. Determine whether manual action is needed.
8. Escalate if financial, legal, fiscal, or data integrity risk exists.

## Timeline Reconstruction

Create a chronological timeline with:

- User action.
- Checkout creation.
- Webhook receipt.
- PaymentRecord creation/update.
- MembershipChangeLog event.
- DunningState transition.
- Notification.
- Audit.
- Admin action.

## Internal Communication

Incident updates should include:

- Impact.
- Current status.
- Suspected cause.
- User-visible effect.
- Actions taken.
- Next action owner.
- ETA if known.

Avoid exposing secrets, internal stack traces, or confidential implementation details.

## Closure

Close an incident only after:

- Root cause is documented.
- User impact is resolved or accepted.
- Records are consistent.
- Any required follow-up is assigned.
- Preventive action is documented.
