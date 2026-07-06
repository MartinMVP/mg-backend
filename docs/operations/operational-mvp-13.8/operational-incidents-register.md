# Operational Incidents Register - Operational MVP 13.8

## Severity Model

| Severity | Definition | Response target | Owner |
| --- | --- | --- | --- |
| P0 | Platform unavailable, data integrity risk, unauthorized access, or live payment/fiscal exposure | Immediate | Engineering + Business owner |
| P1 | Core journey blocked for many users or admin cannot operate queue/recovery | Same business day | Engineering |
| P2 | Single-domain degradation with workaround | 2 business days | Engineering + Admin |
| P3 | Minor defect, documentation gap, cosmetic/admin usability issue | Planned backlog | Product/Admin |

## Active Register

| ID | Severity | Status | Area | Trigger | Detection | Runbook action |
| --- | --- | --- | --- | --- | --- | --- |
| INC-13.8-001 | P1 | Open risk | Revenue | Failed payments accumulate | `/admin/operations/queue`, `/admin/payments` | Reconcile with `/admin/payments/reconcile`, verify audit `ADMIN_PAYMENT_RECONCILED` |
| INC-13.8-002 | P1 | Open risk | Fiscal | Fiscal operations remain failed | `/admin/fiscal`, `/admin/operations/needs-attention` | Recover with `/admin/fiscal/recover`, verify `ADMIN_FISCAL_RECOVERED` |
| INC-13.8-003 | P2 | Open risk | Membership | Membership pending activation after admin action | `/admin/memberships` | Update membership status through admin route and verify audit |
| INC-13.8-004 | P2 | Open risk | Marketplace | Listing requires manual archive | `/admin/listings` | Archive listing and verify `ADMIN_LISTING_ARCHIVED` |
| INC-13.8-005 | P2 | Open risk | Messaging | Conversation must be closed by support | `/admin/conversations` | Close conversation and verify `ADMIN_CONVERSATION_CLOSED` |
| INC-13.8-006 | P0 | Watch | Security | Suspected admin credential compromise | Auth logs, unusual admin audit actions | Suspend impacted user, rotate secrets, preserve audit evidence |
| INC-13.8-007 | P1 | Watch | Operations | Admin dashboard unavailable | `/admin/dashboard` failing | Escalate to engineering, inspect app logs and deployment health |

## Evidence Required Per Incident

- Endpoint called.
- Actor ID.
- Entity ID.
- Timestamp.
- Audit action.
- Before/after status.
- Screenshot or log excerpt when available.
- Final resolution and follow-up owner.
