import { KnowledgeAsset } from './knowledgeAsset.model';
import { KnowledgeCollection } from './knowledgeCollection.model';
import { KnowledgeRecord } from './knowledgeRecord.model';
import { KnowledgeRegistry } from './knowledgeRegistry.model';

function percent(count: number, total: number) {
  return total > 0 ? Math.round((count / total) * 10000) / 100 : 0;
}

export async function getKnowledgeManagementMetrics() {
  const recentThreshold = new Date(Date.now() - 30 * 24 * 60 * 60_000);
  const [
    totalRecords,
    totalCollections,
    totalAssets,
    byDomain,
    byQuality,
    byLifecycle,
    reusableKnowledge,
    authoritativeKnowledge,
    deprecatedKnowledge,
    recentRecords,
  ] = await Promise.all([
    KnowledgeRecord.countDocuments(),
    KnowledgeCollection.countDocuments(),
    KnowledgeAsset.countDocuments(),
    KnowledgeRecord.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$knowledgeDomain', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    KnowledgeRegistry.aggregate<{ _id: string; count: number }>([
      { $match: { 'quality.level': { $exists: true } } },
      { $group: { _id: '$quality.level', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    KnowledgeRegistry.aggregate<{ _id: string; count: number }>([
      { $match: { 'lifecycle.stage': { $exists: true } } },
      { $group: { _id: '$lifecycle.stage', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    KnowledgeRegistry.countDocuments({ 'lifecycle.stage': 'reusable' }),
    KnowledgeRegistry.countDocuments({ 'quality.level': 'authoritative' }),
    KnowledgeRegistry.countDocuments({ status: 'deprecated' }),
    KnowledgeRecord.countDocuments({ createdAt: { $gte: recentThreshold } }),
  ]);

  return {
    totalRecords,
    totalCollections,
    totalAssets,
    byDomain: byDomain.map((item) => ({ domain: item._id, count: item.count })),
    byQuality: byQuality.map((item) => ({ quality: item._id, count: item.count })),
    byLifecycle: byLifecycle.map((item) => ({ lifecycle: item._id, count: item.count })),
    reusableKnowledge,
    authoritativeKnowledge,
    deprecatedKnowledge,
    coverage: byDomain.map((item) => ({
      domain: item._id,
      count: item.count,
      percentage: percent(item.count, totalRecords),
    })),
    freshness: {
      recentRecords,
      percentage: percent(recentRecords, totalRecords),
      windowDays: 30,
    },
  };
}
