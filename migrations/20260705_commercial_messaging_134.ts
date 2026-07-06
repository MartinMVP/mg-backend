import { Db } from 'mongodb';

export async function up(db: Db) {
  await db.collection('conversations').createIndex(
    { type: 1, listingId: 1, sellerId: 1, buyerId: 1, status: 1 },
    { name: 'conversation_listing_context_participants' },
  );
  await db.collection('conversations').createIndex(
    { type: 1, sellerId: 1, updatedAt: -1 },
    { name: 'conversation_listing_seller_activity' },
  );
  await db.collection('conversations').createIndex(
    { type: 1, buyerId: 1, updatedAt: -1 },
    { name: 'conversation_listing_buyer_activity' },
  );
}

export async function down(db: Db) {
  await db.collection('conversations').dropIndex('conversation_listing_context_participants').catch(() => undefined);
  await db.collection('conversations').dropIndex('conversation_listing_seller_activity').catch(() => undefined);
  await db.collection('conversations').dropIndex('conversation_listing_buyer_activity').catch(() => undefined);
}
