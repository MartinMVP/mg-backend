# Restore Procedure

Operational draft for Enlace Ganadero.

## Purpose

This procedure defines safe restore steps for MongoDB Atlas data.

## When To Restore

Consider restore only for:

- Accidental deletion.
- Data corruption.
- Failed migration.
- Large-scale inconsistent membership/payment state.
- Security incident requiring rollback.

Do not restore production over live data without explicit executive and technical approval.

## Pre-Restore Validation

Before restore:

1. Identify incident scope.
2. Identify affected collections.
3. Capture current production backup/snapshot.
4. Freeze high-risk writes if needed.
5. Notify internal stakeholders.
6. Confirm restore target is safe.

## Safe Restore Target

First restore to an isolated environment:

- Separate database name.
- No public frontend connection.
- No Stripe Live credentials.
- No Facturama production credentials.
- No automatic jobs that could mutate production state.

## Restore Steps

1. Select verified backup point.
2. Restore to safe target.
3. Validate collection counts.
4. Validate representative records:
   - Users.
   - Memberships.
   - Payments.
   - Webhook logs.
   - Dunning states.
   - Audit.
5. Compare affected records against production.
6. Decide whether to recover selected records or perform broader rollback.
7. Document all actions.

## Avoid Accidental Overwrite

Never point production application variables to a restored database until approved.

Never run destructive scripts against production during investigation unless approved and backed up.

## Post-Restore Verification

Verify:

- Users can authenticate.
- Memberships have one operational active state.
- PaymentWebhookLog idempotency is preserved.
- PaymentRecord status is consistent.
- DunningState status is consistent.
- Audit timeline remains available.

## Internal Communication

Communicate:

- What was restored.
- Time window affected.
- User impact.
- Follow-up actions.
- Remaining risk.
