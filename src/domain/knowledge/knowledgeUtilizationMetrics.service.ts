import { KnowledgeAsset } from './knowledgeAsset.model';
import { KnowledgeConsumer } from './knowledgeConsumer.model';
import { KnowledgeUtilizationPackage } from './knowledgeUtilizationPackage.model';
import { KnowledgeSnapshot } from './knowledgeSnapshot.model';

function percent(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 10000) / 100 : 0;
}

export async function getKnowledgeUtilizationMetrics() {
  const [
    totalConsumers,
    totalPackages,
    totalSnapshots,
    totalAssets,
    packages,
    byConsumer,
    byDomain,
    byAssetType,
  ] = await Promise.all([
    KnowledgeConsumer.countDocuments(),
    KnowledgeUtilizationPackage.countDocuments(),
    KnowledgeSnapshot.countDocuments(),
    KnowledgeAsset.countDocuments(),
    KnowledgeUtilizationPackage.find().select('assets context').lean(),
    KnowledgeUtilizationPackage.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$context.consumer.consumerType', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    KnowledgeUtilizationPackage.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$context.domain', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    KnowledgeUtilizationPackage.aggregate<{ _id: string; count: number }>([
      { $unwind: '$assets' },
      {
        $lookup: {
          from: 'knowledgeassets',
          localField: 'assets',
          foreignField: '_id',
          as: 'asset',
        },
      },
      { $unwind: '$asset' },
      { $group: { _id: '$asset.assetType', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  const usedAssetIds = new Set(packages.flatMap((pkg) => pkg.assets.map(String)));
  const usedAssets = usedAssetIds.size;
  const averagePackageSize = totalPackages > 0
    ? packages.reduce((sum, pkg) => sum + pkg.assets.length, 0) / totalPackages
    : 0;

  return {
    totalConsumers,
    totalPackages,
    totalSnapshots,
    byConsumer: byConsumer.map((item) => ({ consumer: item._id || 'unknown', count: item.count })),
    byDomain: byDomain.map((item) => ({ domain: item._id || 'unknown', count: item.count })),
    byAssetType: byAssetType.map((item) => ({ assetType: item._id || 'unknown', count: item.count })),
    averagePackageSize,
    knowledgeReuseRate: percent(usedAssets, totalAssets),
    knowledgeCoverage: percent(Math.max(totalAssets - usedAssets, 0), totalAssets),
  };
}
