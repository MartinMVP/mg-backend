# Stripe Live Activation Checklist

## Purpose

This checklist documents what must be true before Enlace Ganadero can activate Stripe Live in a future approved sprint.

This document does not activate Stripe Live.

## Current Status

Stripe Live is not approved. Current code intentionally blocks production environment and sk_live_ keys.

## Pre-Activation Checklist

### Legal And Policy

- Terms of Service approved by legal counsel.
- Privacy Policy approved by legal counsel.
- Membership Policy approved.
- Cancellation Policy approved.
- Refund Policy approved.
- User-facing paid plan copy approved.

### Infrastructure

- MongoDB Atlas backup enabled.
- Restore drill completed and documented.
- Render rollback procedure confirmed.
- Production env variable owner assigned.
- Production deploy window approved.

### Stripe Account

- Stripe business identity verified.
- Bank account verified.
- Tax/business data confirmed.
- Admin access owner assigned.
- Live webhook endpoint configured.
- Live webhook signing secret available in secure secret manager.

### Application

- Future live-mode code change approved.
- STRIPE_ENABLED behavior reviewed.
- STRIPE_ENVIRONMENT=production support reviewed.
- sk_live_ handling reviewed.
- Webhook raw body route verified.
- invoice.paid activation flow tested.
- checkout.session.completed verified not to activate membership.
- Dunning behavior accepted.

### Operations

- Payment operations owner assigned.
- Support owner assigned.
- Incident lead assigned.
- Refund/dispute process approved.
- Reconciliation process approved.
- First customer monitoring owner assigned.

## Required Variables For Future Live Activation

Do not set these until an approved live sprint:

- STRIPE_ENABLED=true
- STRIPE_ENVIRONMENT=production
- STRIPE_SECRET_KEY=<live secret from secure environment only>
- STRIPE_WEBHOOK_SECRET=<live webhook secret from secure environment only>
- STRIPE_SUCCESS_URL=<production success URL>
- STRIPE_CANCEL_URL=<production cancel URL>

Never commit or paste live secrets.

## Activation Order

1. Confirm executive approval.
2. Confirm legal approval.
3. Confirm backup/restore evidence.
4. Confirm Stripe account readiness.
5. Deploy approved live-capable backend.
6. Set production environment variables in Render.
7. Confirm webhook endpoint in Stripe dashboard.
8. Perform non-destructive health checks.
9. Enable checkout for a controlled test user or pilot plan if approved.
10. Monitor first live checkout and invoice.paid end to end.

## Post-Activation Validation

Validate:

- Checkout session created.
- PaymentCustomer created or reused.
- PaymentCheckoutSession open.
- invoice.paid received and verified.
- PaymentWebhookLog processed.
- PaymentRecord succeeded.
- UserMembership activated.
- MembershipChangeLog recorded.
- Notification created.
- Audit recorded.
- Admin dashboard reflects payment and membership.

## Abort Criteria

Abort activation if:

- Live keys appear in logs or docs.
- Webhook signature verification fails.
- invoice.paid does not activate membership.
- Duplicate PaymentRecord is observed.
- Admin dashboard/reporting fails.
- Backup/restore evidence is missing.
- Stripe account/bank status is not verified.
- Support owner is unavailable.

## Immediate Abort Action

Set:

```text
STRIPE_ENABLED=false
```

Then notify internal stakeholders and follow docs/stripe-live-rollback-plan.md.
