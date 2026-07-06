# Operational Risks Register - Operational MVP 13.8

| ID | Risk | Impact | Likelihood | Current control | Residual decision |
| --- | --- | --- | --- | --- | --- |
| R-13.8-001 | Stripe Live is not approved | Real monetization cannot start safely | High | Sandbox/internal revenue flow only | Restriction remains |
| R-13.8-002 | Productive CFDI/PAC/SAT is not approved | Productive fiscal issuance blocked | High | Mock/foundation fiscal platform and recovery | Restriction remains |
| R-13.8-003 | Backup/restore evidence is external to this acceptance | Recovery confidence depends on operational setup | Medium | Code-level recovery and runbooks | Business/infra follow-up |
| R-13.8-004 | Admin misuse of operational actions | Incorrect suspension/archive/close actions | Medium | Admin role guard and audit trail | Monitor audit; require SOP training |
| R-13.8-005 | Failed payments accumulate | Membership support load increases | Medium | Reconciliation endpoint and queue | Daily queue review |
| R-13.8-006 | Fiscal transient failures accumulate | User invoice support workload increases | Medium | Fiscal recovery endpoint and audit | Daily fiscal workspace review |
| R-13.8-007 | Missing public policy copy | Commercial launch ambiguity | High | Internal acceptance docs | Legal/business approval required |
| R-13.8-008 | No frontend admin workspace in this increment | Operators use API/admin tooling | Medium | Backend workspaces and Swagger docs | Acceptable for internal operations only |

## Risk Decision

The risk profile supports GO WITH RESTRICTIONS. Internal operations can proceed, but external monetization and productive fiscal activation remain blocked until their governance gates are closed.
