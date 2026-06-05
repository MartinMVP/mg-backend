export const paymentAuditActions = {
  membershipCheckoutRequested: 'MEMBERSHIP_CHECKOUT_REQUESTED',
  membershipCheckoutCreated: 'MEMBERSHIP_CHECKOUT_CREATED',
  membershipCheckoutFailed: 'MEMBERSHIP_CHECKOUT_FAILED',
  stripeCustomerCreated: 'STRIPE_CUSTOMER_CREATED',
  webhookReceived: 'PAYMENT_WEBHOOK_RECEIVED',
  webhookProcessed: 'PAYMENT_WEBHOOK_PROCESSED',
  webhookFailed: 'PAYMENT_WEBHOOK_FAILED',
  paymentSucceeded: 'MEMBERSHIP_PAYMENT_SUCCEEDED',
  paymentFailed: 'MEMBERSHIP_PAYMENT_FAILED',
  subscriptionUpdated: 'MEMBERSHIP_SUBSCRIPTION_UPDATED',
  subscriptionCancelled: 'MEMBERSHIP_SUBSCRIPTION_CANCELLED',
  revertedToFree: 'MEMBERSHIP_REVERTED_TO_FREE',
} as const;
