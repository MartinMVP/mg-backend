# Disaster Recovery Notes

Operational draft for Enlace Ganadero.

## Purpose

These notes outline recovery considerations for major operational failures.

## Loss Of Database

Actions:

- Stop writes if possible.
- Verify latest MongoDB Atlas backup.
- Restore to safe environment first.
- Validate memberships, payments, webhooks, notifications, and audit records.
- Restore production only after approval.

## Failed Deploy

Actions:

- Identify last known good commit.
- Use Render rollback if available.
- Confirm environment variables were not changed accidentally.
- Check health endpoint.
- Review logs.

## Loss Of Environment Variables

Actions:

- Reconstruct from approved secret manager or Render environment history.
- Do not use secrets from chat, logs, or commits.
- Rotate any secret suspected to be exposed.
- Validate JWT, MongoDB, Stripe sandbox, and other required variables.

## Data Corruption

Actions:

- Identify affected collections.
- Stop automated processes if they could worsen corruption.
- Compare against backup.
- Recover selected records where possible.
- Keep audit trail of corrective action.

## Duplicate Webhooks

Expected controls:

- PaymentWebhookLog providerEventId uniqueness.
- payloadHash.
- processed flag.

Actions:

- Confirm duplicate event did not duplicate PaymentRecord.
- Confirm membership state remained consistent.
- Escalate if business state duplicated.

## Manual Recovery

Manual recovery must:

- Be approved.
- Be documented.
- Preserve evidence.
- Avoid direct untracked database edits when possible.
- Include post-action verification.

## Responsible Parties

Assign named owners before production:

- Incident lead.
- Backend operator.
- Database operator.
- Payment operations owner.
- Support owner.
- Executive approver.
