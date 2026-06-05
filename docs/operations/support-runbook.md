# Support Runbook

Operational draft for Enlace Ganadero support.

## Purpose

This runbook helps support review user, membership, listing, payment, and operational questions before production monetization.

## General Intake

Collect:

- User email.
- User name if available.
- Date and time of issue.
- Screenshots or user description.
- Listing, membership, checkout, or payment references if available.
- Whether the issue affects publishing, payment, suspension, cancellation, or access.

## Identify User

Use admin tools to locate the user by email or userId. Confirm that any response is sent only to the affected user or authorized admin contact.

## Review Membership

Check:

- UserMembership status.
- Active plan.
- currentPeriodStart and currentPeriodEnd.
- cancelAtPeriodEnd.
- Pending plan change fields.
- MembershipUsage for the current period.
- MembershipChangeLog.

## Review Listings

Check:

- Listing owner/seller.
- Listing status.
- Active listing count.
- Whether membership capacity blocks new published listings.
- Whether existing listings remain intact after suspension or downgrade.

## Review Payments

Check:

- PaymentCustomer.
- PaymentCheckoutSession.
- PaymentRecord.
- PaymentWebhookLog.
- DunningState.
- Audit.

Never ask for full card number, CVC, passwords, live keys, or secrets.

## Escalation

Escalate when:

- Payment succeeded but membership did not activate.
- User reports duplicate charge.
- User requests refund.
- User disputes suspension.
- Webhook log shows failed processing.
- Data appears inconsistent.
- Security or fraud is suspected.

## Evidence Required

Keep evidence references:

- UserId.
- MembershipId.
- PaymentRecordId.
- CheckoutSessionId.
- Webhook providerEventId.
- Audit actions.
- Relevant timestamps.

## What Support Must Not Do

Support must not:

- Promise refunds without administrative approval.
- Collect card PAN or CVC.
- Modify database records manually without approval.
- Promise CFDI, PAC, SAT, XML, PDF, or fiscal UUID generation.
- State that Enlace Ganadero sells, owns, or invoices cattle.
