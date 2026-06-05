# Backup Policy

Operational draft for Enlace Ganadero.

## Purpose

This policy defines expected backup governance for MongoDB Atlas and critical platform data.

## Scope

Critical data includes:

- Users.
- Sessions where applicable.
- Catalog, animals, listings, and media metadata.
- MembershipPlan.
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
- Fiscal preparation records.

## MongoDB Atlas

Production data should use MongoDB Atlas backup features appropriate to the selected cluster tier.

Required operational evidence:

- Backup feature enabled.
- Backup frequency documented.
- Retention period documented.
- Responsible owner assigned.
- Restore drill schedule documented.

## Expected Frequency

Recommended minimum before real charges:

- Daily backups.
- Point-in-time recovery if supported by the Atlas tier.
- Manual pre-release backup before high-risk production changes.

## Environments

Backups must distinguish:

- Production.
- Staging or sandbox.
- Local development.

Production data must not be restored into unsafe or publicly accessible environments.

## Verification

At least once per release cycle or before Stripe Live:

- Confirm latest backup exists.
- Confirm restore can be initiated to a safe target.
- Confirm restored data integrity for memberships, payments, webhooks, and audit trails.

## Evidence

Maintain evidence outside code:

- Date of backup verification.
- Atlas project and cluster reference.
- Restore target.
- Operator.
- Result.
- Issues found.

## Ownership

Assign an operational owner for backup verification and restore approval before monetization launch.
