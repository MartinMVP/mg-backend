# Stripe Environment Matrix

## Purpose

This matrix separates sandbox and live Stripe behavior for Enlace Ganadero.

## Current Rule

Stripe Live is not enabled. Current backend validation is sandbox-only and blocks sk_live_ keys.

## Environment Matrix

| Item | Sandbox | Live |
| --- | --- | --- |
| STRIPE_ENABLED | false by default; true only for controlled sandbox tests | Not approved |
| STRIPE_ENVIRONMENT | sandbox | production, future only |
| STRIPE_SECRET_KEY | sk_test_ only | sk_live_ would require approved future change |
| STRIPE_WEBHOOK_SECRET | sandbox webhook secret | live webhook secret, future only |
| STRIPE_SUCCESS_URL | sandbox/frontend test URL | production frontend URL |
| STRIPE_CANCEL_URL | sandbox/frontend test URL | production frontend URL |
| Checkout | Allowed only when sandbox config passes | Not currently allowed |
| Webhooks | Signed sandbox events validated | Future signed live events only |
| Charges | Test only | Not approved |
| Refunds | Not operationally active | Requires runbook and approval |

## Key Rules

- Never commit Stripe keys.
- Never paste Stripe keys into docs or chat.
- Never use sk_live_ in local tests.
- Never use live keys until executive approval.
- Keep sandbox and live webhook secrets separate.
- Keep sandbox and live Stripe dashboards separate during investigation.

## Webhook Rules

Sandbox:

- Use sandbox signing secret.
- Validate invoice.paid activation.
- Validate payment_failed/dunning.

Live:

- Requires future approval.
- Requires production endpoint validation.
- Requires first-payment monitoring.
- Requires rollback plan ready.

## URL Rules

Sandbox URLs may point to staging, local tunnel, or controlled sandbox frontend.

Live URLs must point only to approved production frontend URLs and must be verified before enabling checkout.

## Current Restrictions

The current code rejects:

- STRIPE_ENVIRONMENT=production when Stripe is enabled.
- STRIPE_SECRET_KEY beginning with sk_live_.
- Non-sk_test_ keys when Stripe is enabled.

These restrictions must remain until a future approved Stripe Live sprint changes them intentionally.
