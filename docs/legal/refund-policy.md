# Refund Policy - Draft

Operational draft for Enlace Ganadero.

This document is an initial operational draft and must be reviewed by legal counsel before production use.

## Purpose

This policy defines expected handling of refund requests for Enlace Ganadero platform services.

## Scope

Refunds may apply to payments for platform services such as memberships or future promotional services. This policy does not apply to cattle purchases between users.

Enlace Ganadero does not process cattle sale payments and does not refund cattle transactions between buyer and seller.

## Membership Payments

Membership payments may be reviewed when a user reports billing issues, incorrect charges, duplicate charges, failed access after payment, or other operational problems.

## Administrative Review

Refunds are not automatic. Each case should be reviewed administratively using available evidence:

- PaymentRecord.
- PaymentCheckoutSession.
- PaymentWebhookLog.
- UserMembership.
- MembershipChangeLog.
- DunningState.
- Notification.
- Audit.

## Payment Errors

If an incorrect or duplicate charge is suspected, support should collect evidence and escalate to the payment operations owner before making commitments to the user.

## Stripe As Future Processor

Stripe may act as payment processor. Any refund operation through Stripe must follow approved production runbooks and must not be performed without authorization.

## No Automatic Promise

This draft does not promise automatic refunds, instant refunds, or refunds in all cases. Refund eligibility depends on administrative review, applicable law, provider status, and final approved policy.

## Changes

This policy may be updated before production launch. Final policy must be approved by legal counsel before public use.
