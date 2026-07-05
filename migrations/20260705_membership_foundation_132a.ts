import { Db } from 'mongodb';

export async function up(db: Db) {
  await db.collection('membershipplans').createIndex({ code: 1 }, { unique: true, name: 'membership_plan_code_unique' });
  await db.collection('membershipplans').updateOne(
    { code: 'free' },
    {
      $setOnInsert: {
        name: 'Free',
        code: 'free',
        description: 'Membresía básica gratuita para comenzar en Enlace Ganadero.',
        monthlyPrice: 0,
        yearlyPrice: 0,
        durationDays: 365,
        price: 0,
        currency: 'MXN',
        billingPeriod: 'manual',
        benefits: {
          maxActiveListings: 1,
          maxPhotosPerListing: 3,
          canUseFeaturedListings: false,
          includedFeaturedListings: 0,
          canAccessAuctions: false,
          canAccessMetrics: false,
          supportLevel: 'basic',
        },
        limits: { animalListings: 1, auctionListings: 0, mediaUploads: 3, messaging: 100, featuredPublications: 0 },
        isActive: true,
        isPublic: true,
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
  await db.collection('membershipbenefits').createIndex(
    { membershipId: 1, feature: 1 },
    { unique: true, sparse: true, name: 'membership_benefit_membership_feature_unique' }
  );
  await db.collection('membershiphistories').createIndex({ membershipId: 1, createdAt: -1 }, { name: 'membership_history_lookup' });
}

export async function down(db: Db) {
  await db.collection('membershipbenefits').dropIndex('membership_benefit_membership_feature_unique').catch(() => undefined);
  await db.collection('membershiphistories').dropIndex('membership_history_lookup').catch(() => undefined);
}
