# Dunning Runbook

Operational draft for Enlace Ganadero payment recovery.

## Purpose

This runbook explains the expected handling of payment failure states.

## Statuses

### grace_period

The membership has a payment failure but keeps operational benefits during the grace period.

Support may:

- Confirm the user is in grace_period.
- Explain that payment needs attention.
- Review DunningState and Notification.

Support must not:

- Manually charge the user.
- Promise automatic recovery.

### in_dunning

The grace period expired and the account is in active recovery.

Support may:

- Review retrySchedule.
- Confirm nextActionAt.
- Escalate if payment has been made but not reflected.

### suspended

Dunning reached suspension threshold.

Expected behavior:

- Existing listings remain intact.
- New publications may be blocked.
- Support can explain that membership must be recovered or reviewed.

### recovered

Payment recovery has been confirmed and membership returned to active.

Support should verify:

- DunningState recoveredAt.
- UserMembership active.
- Notification membership_recovered.
- PaymentRecord succeeded.

## processDunningDue

Admin processDunningDue advances due dunning states. It must not call Stripe, create PaymentIntent, charge a user, or generate CFDI.

## What Support Can Do

- Review status.
- Collect evidence.
- Explain the membership state.
- Escalate payment or data inconsistencies.

## What Support Must Not Do

- Charge manually from the system.
- Delete listings as a dunning response.
- Promise refund without approval.
- Modify membership state manually outside approved admin processes.
- Claim Enlace Ganadero handles cattle sale payments.
