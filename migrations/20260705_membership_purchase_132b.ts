import { Db } from 'mongodb';

export async function up(db: Db) {
  await db.collection('membershippaymentsessions').createIndex(
    { stripeCheckoutSessionId: 1 },
    { unique: true, name: 'membership_payment_session_stripe_checkout_unique' }
  );
  await db.collection('membershippaymentsessions').createIndex(
    { checkoutRequestId: 1 },
    { unique: true, name: 'membership_payment_session_request_unique' }
  );
  await db.collection('membershippaymenttransactions').createIndex(
    { stripeEventId: 1 },
    { unique: true, name: 'membership_payment_transaction_event_unique' }
  );
  await db.collection('paymentwebhooklogs').createIndex(
    { providerEventId: 1 },
    { unique: true, name: 'payment_webhook_provider_event_unique' }
  );
}

export async function down(db: Db) {
  await db.collection('membershippaymentsessions').dropIndex('membership_payment_session_stripe_checkout_unique').catch(() => undefined);
  await db.collection('membershippaymentsessions').dropIndex('membership_payment_session_request_unique').catch(() => undefined);
  await db.collection('membershippaymenttransactions').dropIndex('membership_payment_transaction_event_unique').catch(() => undefined);
}
