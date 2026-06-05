# Cancellation Policy - Draft

Operational draft for Enlace Ganadero.

This document is an initial operational draft and must be reviewed by legal counsel before production use.

## Purpose

This policy defines expected cancellation behavior for memberships in Enlace Ganadero.

## Cancel At Period End

Membership cancellation should normally be scheduled at the end of the current billing period. This is represented operationally as cancelAtPeriodEnd.

## Benefits During Current Period

When cancellation is scheduled, the user keeps current membership benefits until the currentPeriodEnd date, unless there is fraud, abuse, legal risk, or administrative suspension.

## Return To Free

When the paid period ends and cancellation is processed, the paid membership becomes cancelled and a Free membership should be active.

## Existing Listings

Cancellation does not automatically delete existing listings. If the resulting plan has lower capacity, the platform may block new published listings until usage is within the active plan limit.

## Reactivation

If cancellation has not taken effect, the user may reactivate the membership. Reactivation clears cancelAtPeriodEnd and related pending fields where applicable.

## Administrative Cases

Support may review cancellation cases using UserMembership, MembershipChangeLog, PaymentRecord, DunningState, Notification, and Audit.

Support should not promise manual payment correction, refund, or fiscal changes without administrative approval.

## Changes

This policy may be updated before production launch. Final policy must be approved by legal counsel before public use.
