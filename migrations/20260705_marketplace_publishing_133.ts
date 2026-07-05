import { Db } from 'mongodb';

export async function up(db: Db) {
  await db.collection('listings').createIndex({ seller: 1, animal: 1, status: 1 }, { name: 'listing_seller_animal_status' });
  await db.collection('listings').createIndex({ publishedAt: -1 }, { name: 'listing_published_at' });
  await db.collection('listings').createIndex({ archivedAt: -1 }, { name: 'listing_archived_at' });
  await db.collection('animals').createIndex({ owner: 1, status: 1 }, { name: 'animal_owner_status' });
  await db.collection('mediareferences').createIndex({ mediaId: 1, ownerId: 1 }, { unique: true, name: 'media_reference_owner_unique' });
  await db.collection('mediareferences').createIndex({ ownerId: 1, createdAt: -1 }, { name: 'media_reference_owner_created' });
}

export async function down(db: Db) {
  await db.collection('listings').dropIndex('listing_seller_animal_status').catch(() => undefined);
  await db.collection('listings').dropIndex('listing_published_at').catch(() => undefined);
  await db.collection('listings').dropIndex('listing_archived_at').catch(() => undefined);
  await db.collection('animals').dropIndex('animal_owner_status').catch(() => undefined);
  await db.collection('mediareferences').dropIndex('media_reference_owner_unique').catch(() => undefined);
  await db.collection('mediareferences').dropIndex('media_reference_owner_created').catch(() => undefined);
}
