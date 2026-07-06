# Operational Runbook - Operational MVP 13.8

## Purpose

Operate Enlace Ganadero without direct database access for normal support, administration, and recovery work.

## Roles

| Role | Scope |
| --- | --- |
| Admin | Read operational workspaces, review queues, manage routine operational actions. |
| Super | Same as admin, plus super-only configuration and sensitive administrative controls where existing routes require it. |
| Engineering | Production incident investigation, deploy/rollback, schema/migration handling, and code fixes. |
| Business owner | Go/no-go decisions, policy approval, commercial restrictions, and external user communication. |

## Daily Operating Checks

1. Open `GET /admin/dashboard`.
2. Review `GET /admin/operations/queue`.
3. Review `GET /admin/operations/needs-attention`.
4. Check:
   - Failed payments.
   - Fiscal failures.
   - Pending memberships.
   - Active conversations requiring support.
   - Archived or blocked listings.
5. Record any incident in the Operational Incidents Register.

## Workspace Procedures

### Users Workspace

Endpoint: `GET /admin/users`

Use for:

- User lookup.
- Role/status visibility.
- Support triage.

Operational action:

- `POST /admin/users/:id/suspend`
- Audit event: `ADMIN_USER_SUSPENDED`

### Membership Workspace

Endpoint: `GET /admin/memberships`

Use for:

- Membership state review.
- Activation, suspension, cancellation, and expiration verification.
- Support escalation.

Operational action:

- `PATCH /admin/memberships/:id`
- Audit event: `ADMIN_MEMBERSHIP_UPDATED`

### Marketplace Workspace

Endpoint: `GET /admin/listings`

Use for:

- Listing review.
- Publication state checks.
- Seller support.

Operational action:

- `POST /admin/listings/:id/archive`
- Audit event: `ADMIN_LISTING_ARCHIVED`

### Messaging Workspace

Endpoint: `GET /admin/conversations`

Use for:

- Conversation state review.
- Support or abuse triage.

Operational action:

- `POST /admin/conversations/:id/close`
- Audit event: `ADMIN_CONVERSATION_CLOSED`

### Revenue Workspace

Endpoint: `GET /admin/payments`

Use for:

- Payment review.
- Failed transaction triage.
- Membership payment support.

Operational action:

- `POST /admin/payments/reconcile`
- Audit event: `ADMIN_PAYMENT_RECONCILED`

Restriction:

- Do not enable Stripe Live unless separately approved.

### Fiscal Workspace

Endpoint: `GET /admin/fiscal`

Use for:

- Fiscal operation review.
- Failed fiscal operation triage.

Operational action:

- `POST /admin/fiscal/recover`
- Audit event: `ADMIN_FISCAL_RECOVERED`

Restriction:

- Productive CFDI/PAC/SAT issuance remains outside this acceptance.

## Incident Handling

1. Classify P0/P1/P2/P3.
2. Capture endpoint, user ID, entity ID, timestamp, and audit action.
3. Review queue/needs-attention.
4. Execute only approved operational actions.
5. Re-check audit and persistence.
6. Update incident register with final state.

## Stop Conditions

Escalate immediately if any of these occur:

- Unauthorized admin access suspected.
- Payment reconciliation creates inconsistent totals.
- Fiscal recovery fails repeatedly for transient failures.
- Data appears missing from admin workspace but exists in domain endpoint.
- Audit event is missing after an operational action.
- Production secrets, Stripe Live, PAC/SAT, or CFDI productive settings are involved.
