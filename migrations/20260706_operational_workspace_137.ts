import type { Db } from 'mongodb';

export async function up(db: Db) {
  await db.collection('users').updateMany({ status: { $exists: false } }, { $set: { status: 'active' } });
  await db.collection('users').createIndex({ status: 1 }, { name: 'user_status' });
}

export async function down(db: Db) {
  await db.collection('users').dropIndex('user_status').catch(() => undefined);
}
