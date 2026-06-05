# Stripe Live Activation Decision - Sprint 9.9

## Decision

NOT READY FOR STRIPE LIVE

## Justification

Enlace Ganadero is not ready to enable Stripe Live because current application controls intentionally enforce sandbox-only Stripe operation:

- STRIPE_ENABLED defaults to false.
- STRIPE_ENVIRONMENT defaults to sandbox.
- STRIPE_ENVIRONMENT=production is rejected when Stripe is enabled.
- sk_live_ keys are rejected.
- sk_test_ is required when Stripe is enabled.

This is the correct safety posture for the current stage.

## What Is Ready

- Sandbox revenue flow has been validated.
- Webhook signature processing exists.
- invoice.paid is the activation event.
- checkout.session.completed does not activate membership.
- PaymentWebhookLog supports idempotency.
- PaymentRecord supports reconciliation.
- Dunning lifecycle exists.
- Admin dashboard and reports exist.
- Rollback and activation documentation now exists.

## What Is Not Ready

- Live mode support is not enabled in code.
- Live Stripe account readiness is not evidenced in repository docs.
- Live webhook secret handling is not rehearsed.
- Legal policies are still drafts.
- Backup/restore drill evidence remains pending.
- First live payment monitoring is not rehearsed.
- Refund/dispute process is not fully operationalized.

## Conditions Required Before Reconsidering

- Legal approval of terms, privacy, membership, cancellation, and refund policies.
- MongoDB Atlas backup and restore drill completed.
- Stripe account, identity, bank, and webhook configured.
- Payment operations owner assigned.
- Support team trained on runbooks.
- Production monitoring and alert owner assigned.
- Future approved code/configuration sprint to support live mode safely.

## Explicit Non-Approval

This decision does not approve:

- Stripe Live activation.
- sk_live_ usage.
- Real charges.
- Real subscription creation.
- Real payment collection.
- Real refunds.
- CFDI/PAC/SAT production work.
- BillableEvent implementation.

## Next Recommended Step

Prepare a future Stripe Live implementation plan only after external dependencies and operational ownership are verified. Until then, continue sandbox-only validation.
