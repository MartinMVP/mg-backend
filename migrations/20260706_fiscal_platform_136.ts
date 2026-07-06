import { Db } from 'mongodb';

export async function up(db: Db) {
  await db.collection('fiscaloperations').createIndex({ commercialOperationId: 1 }, { unique: true, name: 'fiscal_operation_commercial_operation_unique' });
  await db.collection('fiscaloperations').createIndex({ operationId: 1 }, { name: 'fiscal_operation_payment_settlement' });
  await db.collection('fiscaloperations').createIndex({ invoiceStatus: 1, updatedAt: -1 }, { name: 'fiscal_operation_status_updated' });
  await db.collection('fiscaloperations').createIndex({ uuid: 1 }, { name: 'fiscal_operation_uuid' });
  await db.collection('fiscaloperationhistories').createIndex({ fiscalOperationId: 1, createdAt: 1 }, { name: 'fiscal_operation_history_operation_created' });
  await db.collection('fiscaloperationhistories').createIndex({ commercialOperationId: 1, createdAt: 1 }, { name: 'fiscal_operation_history_commercial_created' });
}

export async function down(db: Db) {
  await db.collection('fiscaloperations').dropIndex('fiscal_operation_commercial_operation_unique').catch(() => undefined);
  await db.collection('fiscaloperations').dropIndex('fiscal_operation_payment_settlement').catch(() => undefined);
  await db.collection('fiscaloperations').dropIndex('fiscal_operation_status_updated').catch(() => undefined);
  await db.collection('fiscaloperations').dropIndex('fiscal_operation_uuid').catch(() => undefined);
  await db.collection('fiscaloperationhistories').dropIndex('fiscal_operation_history_operation_created').catch(() => undefined);
  await db.collection('fiscaloperationhistories').dropIndex('fiscal_operation_history_commercial_created').catch(() => undefined);
}
