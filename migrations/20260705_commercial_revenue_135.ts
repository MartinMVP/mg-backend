import { Db } from 'mongodb';

export async function up(db: Db) {
  await db.collection('commercialoperations').createIndex({ operationNumber: 1 }, { unique: true, name: 'commercial_operation_number_unique' });
  await db.collection('commercialoperations').createIndex({ operationType: 1, referenceType: 1, referenceId: 1 }, { name: 'commercial_operation_reference' });
  await db.collection('paymenttransactions').createIndex({ providerPaymentIntentId: 1 }, { unique: true, name: 'payment_transaction_provider_intent_unique' });
  await db.collection('paymenttransactions').createIndex({ operationId: 1, status: 1 }, { name: 'payment_transaction_operation_status' });
  await db.collection('paymentsettlements').createIndex({ operationId: 1 }, { unique: true, name: 'payment_settlement_operation_unique' });
  await db.collection('paymentsettlements').createIndex({ providerEventId: 1 }, { unique: true, name: 'payment_settlement_event_unique' });
  await db.collection('refundrecords').createIndex({ operationId: 1, status: 1 }, { name: 'refund_record_operation_status' });
  await db.collection('reconciliationrecords').createIndex({ executedAt: -1 }, { name: 'reconciliation_record_executed_at' });
}

export async function down(db: Db) {
  await db.collection('commercialoperations').dropIndex('commercial_operation_number_unique').catch(() => undefined);
  await db.collection('commercialoperations').dropIndex('commercial_operation_reference').catch(() => undefined);
  await db.collection('paymenttransactions').dropIndex('payment_transaction_provider_intent_unique').catch(() => undefined);
  await db.collection('paymenttransactions').dropIndex('payment_transaction_operation_status').catch(() => undefined);
  await db.collection('paymentsettlements').dropIndex('payment_settlement_operation_unique').catch(() => undefined);
  await db.collection('paymentsettlements').dropIndex('payment_settlement_event_unique').catch(() => undefined);
  await db.collection('refundrecords').dropIndex('refund_record_operation_status').catch(() => undefined);
  await db.collection('reconciliationrecords').dropIndex('reconciliation_record_executed_at').catch(() => undefined);
}
