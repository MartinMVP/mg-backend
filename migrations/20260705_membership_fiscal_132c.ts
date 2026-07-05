import { Db } from 'mongodb';

export async function up(db: Db) {
  await db.collection('invoicerecords').createIndex(
    { transactionId: 1 },
    {
      unique: true,
      partialFilterExpression: {
        membershipId: { $exists: true },
        status: { $in: ['pending', 'processing', 'issued', 'cancel_requested', 'cancel_processing', 'failed', 'cancel_failed'] },
      },
      name: 'uniq_membership_active_cfdi_by_transaction',
    }
  );
  await db.collection('invoicerecords').createIndex({ userId: 1, createdAt: -1 }, { name: 'membership_invoice_user_created' });
  await db.collection('invoicerecords').createIndex({ membershipId: 1, createdAt: -1 }, { name: 'membership_invoice_membership_created' });
  await db.collection('invoicehistories').createIndex({ invoiceId: 1, timestamp: -1 }, { name: 'invoice_history_invoice_timestamp' });
  await db.collection('invoicehistories').createIndex({ userId: 1, timestamp: -1 }, { name: 'invoice_history_user_timestamp' });
}

export async function down(db: Db) {
  await db.collection('invoicerecords').dropIndex('uniq_membership_active_cfdi_by_transaction').catch(() => undefined);
  await db.collection('invoicerecords').dropIndex('membership_invoice_user_created').catch(() => undefined);
  await db.collection('invoicerecords').dropIndex('membership_invoice_membership_created').catch(() => undefined);
  await db.collection('invoicehistories').dropIndex('invoice_history_invoice_timestamp').catch(() => undefined);
  await db.collection('invoicehistories').dropIndex('invoice_history_user_timestamp').catch(() => undefined);
}
