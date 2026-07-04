import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import {
  PlatformConfiguration,
  PlatformConfigurationEnvironment,
  PlatformConfigurationValueType,
  platformConfigurationEnvironments,
  platformConfigurationValueTypes,
} from './platformConfiguration.model';

export const platformConfigurationAuditActions = {
  created: 'CONFIG_CREATED',
  updated: 'CONFIG_UPDATED',
  activated: 'CONFIG_ACTIVATED',
} as const;

const defaultLimit = 50;
const maxLimit = 100;

type PaginationInput = {
  page?: unknown;
  limit?: unknown;
};

export const sandboxDefaultConfigurations: Array<{
  key: string;
  valueType: PlatformConfigurationValueType;
  value: unknown;
  description: string;
  isProtected?: boolean;
}> = [
  {
    key: 'messaging.free.dailyConversationLimit',
    valueType: 'number',
    value: 10,
    description: 'Sandbox daily conversation limit for free memberships',
  },
  {
    key: 'messaging.pro.dailyConversationLimit',
    valueType: 'number',
    value: 50,
    description: 'Sandbox daily conversation limit for pro memberships',
  },
  {
    key: 'messaging.business.dailyConversationLimit',
    valueType: 'number',
    value: 1000,
    description: 'Sandbox daily conversation limit for business memberships',
  },
  {
    key: 'listings.defaultExpirationDays',
    valueType: 'number',
    value: 30,
    description: 'Sandbox default listing expiration in days',
  },
  {
    key: 'auction.minDurationDays',
    valueType: 'number',
    value: 5,
    description: 'Sandbox minimum Auction Listing duration in days',
  },
  {
    key: 'auction.maxDurationDays',
    valueType: 'number',
    value: 10,
    description: 'Sandbox maximum Auction Listing duration in days',
  },
  {
    key: 'auction.defaultDurationDays',
    valueType: 'number',
    value: 7,
    description: 'Sandbox default Auction Listing duration in days',
  },
  {
    key: 'auction.snipingExtensionMinutes',
    valueType: 'number',
    value: 5,
    description: 'Sandbox anti-sniping window and extension in minutes',
  },
  {
    key: 'auction.maxExtensions',
    valueType: 'number',
    value: 3,
    description: 'Sandbox anti-sniping maximum extensions',
  },
  {
    key: 'auction.incrementTier1',
    valueType: 'number',
    value: 500,
    description: 'Sandbox Auction Listing minimum increment tier 1',
  },
  {
    key: 'auction.incrementTier2',
    valueType: 'number',
    value: 1000,
    description: 'Sandbox Auction Listing minimum increment tier 2',
  },
  {
    key: 'auction.incrementTier3',
    valueType: 'number',
    value: 2500,
    description: 'Sandbox Auction Listing minimum increment tier 3',
  },
  {
    key: 'auction.sanctions.firstOffenseDays',
    valueType: 'number',
    value: 30,
    description: 'Sandbox Auction Listing first default sanction duration in days',
  },
  {
    key: 'auction.sanctions.secondOffenseDays',
    valueType: 'number',
    value: 180,
    description: 'Sandbox Auction Listing second default sanction duration in days',
  },
  {
    key: 'auction.sanctions.thirdOffensePolicy',
    valueType: 'string',
    value: 'permanent',
    description: 'Sandbox Auction Listing third offense policy',
  },
  {
    key: 'auction.sanctions.allowAppeals',
    valueType: 'boolean',
    value: true,
    description: 'Sandbox Auction Listing sanction appeals switch',
  },
  {
    key: 'auction.sanctions.appealWaitingDays',
    valueType: 'number',
    value: 365,
    description: 'Sandbox Auction Listing sanction appeal waiting period in days',
  },
  {
    key: 'auction.sanctions.permanentThreshold',
    valueType: 'number',
    value: 3,
    description: 'Sandbox Auction Listing permanent sanction threshold',
  },
  {
    key: 'aoe.enabled',
    valueType: 'boolean',
    value: true,
    description: 'Sandbox AOE platform core switch',
  },
  {
    key: 'aoe.collectEvidence',
    valueType: 'boolean',
    value: true,
    description: 'Sandbox AOE evidence collection switch',
  },
  {
    key: 'aoe.generateDecisionProposals',
    valueType: 'boolean',
    value: true,
    description: 'Sandbox AOE decision proposal switch',
  },
  {
    key: 'aoe.autoEscalate',
    valueType: 'boolean',
    value: true,
    description: 'Sandbox AOE escalation switch',
  },
  {
    key: 'aoe.minimumConfidence',
    valueType: 'number',
    value: 70,
    description: 'Sandbox AOE minimum proposal confidence',
  },
  {
    key: 'aoe.executionEnabled',
    valueType: 'boolean',
    value: false,
    description: 'Sandbox AOE execution switch, fixed off for v1',
    isProtected: true,
  },];

function reject(status: number, message: string): never {
  const error = new Error(message);
  (error as any).status = status;
  throw error;
}

function normalizeKey(key: unknown) {
  const normalized = String(key || '').trim();
  if (!normalized) reject(400, 'platform_configuration_key_required');
  return normalized;
}

function normalizeEnvironment(environment: unknown): PlatformConfigurationEnvironment {
  const normalized = String(environment || '').trim();
  if (!platformConfigurationEnvironments.includes(normalized as PlatformConfigurationEnvironment)) {
    reject(400, 'platform_configuration_environment_invalid');
  }
  return normalized as PlatformConfigurationEnvironment;
}

function normalizeValueType(valueType: unknown): PlatformConfigurationValueType {
  const normalized = String(valueType || '').trim();
  if (!platformConfigurationValueTypes.includes(normalized as PlatformConfigurationValueType)) {
    reject(400, 'platform_configuration_value_type_invalid');
  }
  return normalized as PlatformConfigurationValueType;
}

function normalizeObjectId(id: string | Types.ObjectId) {
  if (!Types.ObjectId.isValid(String(id))) reject(400, 'invalid_object_id');
  return typeof id === 'string' ? new Types.ObjectId(id) : id;
}

function normalizePagination(input: PaginationInput = {}) {
  const parsedPage = Number(input.page);
  const parsedLimit = Number(input.limit);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;
  const limit = Number.isFinite(parsedLimit) && parsedLimit >= 1
    ? Math.min(Math.floor(parsedLimit), maxLimit)
    : defaultLimit;

  return { page, limit, skip: (page - 1) * limit };
}

function assertValueMatchesType(valueType: PlatformConfigurationValueType, value: unknown) {
  const ok = valueType === 'string'
    ? typeof value === 'string'
    : valueType === 'number'
      ? typeof value === 'number' && Number.isFinite(value)
      : valueType === 'boolean'
        ? typeof value === 'boolean'
        : value !== null && typeof value === 'object';

  if (!ok) reject(400, 'platform_configuration_value_type_mismatch');
}

async function audit(actor: string, action: string, payload: Record<string, unknown>) {
  await Audit.create({ actor, action, payload });
}

export async function getConfig(key: string, environment: PlatformConfigurationEnvironment) {
  return PlatformConfiguration.findOne({
    key: normalizeKey(key),
    environment: normalizeEnvironment(environment),
    isActive: true,
  }).lean();
}

export async function getConfigValue<T = unknown>(
  key: string,
  environment: PlatformConfigurationEnvironment,
  fallback?: T
): Promise<T | unknown> {
  const config = await getConfig(key, environment);
  return config ? config.value : fallback;
}

export async function setConfig(input: {
  key: string;
  environment: PlatformConfigurationEnvironment;
  value: unknown;
  valueType: PlatformConfigurationValueType;
  description?: string;
  isProtected?: boolean;
  changedBy: string | Types.ObjectId;
}) {
  const key = normalizeKey(input.key);
  const environment = normalizeEnvironment(input.environment);
  const valueType = normalizeValueType(input.valueType);
  const changedBy = normalizeObjectId(input.changedBy);
  assertValueMatchesType(valueType, input.value);

  const latest = await PlatformConfiguration.findOne({ key, environment }).sort({ version: -1 });
  const version = latest ? latest.version + 1 : 1;

  await PlatformConfiguration.updateMany({ key, environment, isActive: true }, { $set: { isActive: false } });

  try {
    const config = await PlatformConfiguration.create({
      key,
      environment,
      version,
      valueType,
      value: input.value,
      description: input.description,
      isProtected: input.isProtected,
      createdBy: changedBy,
      isActive: true,
    });

    await audit(String(changedBy), version === 1
      ? platformConfigurationAuditActions.created
      : platformConfigurationAuditActions.updated, {
      key,
      environment,
      version,
      configurationId: String(config._id),
    });
    await audit(String(changedBy), platformConfigurationAuditActions.activated, {
      key,
      environment,
      version,
      configurationId: String(config._id),
    });

    return config;
  } catch (error) {
    if ((error as any)?.code === 11000) reject(409, 'platform_configuration_active_version_conflict');
    throw error;
  }
}

export async function listConfigs(filters: PaginationInput & {
  environment?: PlatformConfigurationEnvironment;
  key?: string;
  activeOnly?: boolean;
} = {}) {
  const pagination = normalizePagination(filters);
  const query: Record<string, unknown> = {};
  if (filters.environment) query.environment = normalizeEnvironment(filters.environment);
  if (filters.key) query.key = normalizeKey(filters.key);
  if (filters.activeOnly !== false) query.isActive = true;

  const [total, configurations] = await Promise.all([
    PlatformConfiguration.countDocuments(query),
    PlatformConfiguration.find(query)
      .sort({ key: 1, environment: 1, version: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
  ]);

  return { page: pagination.page, limit: pagination.limit, total, configurations };
}

export async function listConfigHistory(key: string, environment: PlatformConfigurationEnvironment) {
  const configurations = await PlatformConfiguration.find({
    key: normalizeKey(key),
    environment: normalizeEnvironment(environment),
  }).sort({ version: -1 }).lean();

  return { key: normalizeKey(key), environment: normalizeEnvironment(environment), configurations };
}

export async function seedSandboxDefaultConfigurations(changedBy: string | Types.ObjectId) {
  const created = [];
  for (const config of sandboxDefaultConfigurations) {
    const existing = await PlatformConfiguration.exists({
      key: config.key,
      environment: 'sandbox',
      isActive: true,
    });
    if (!existing) {
      created.push(await setConfig({
        ...config,
        environment: 'sandbox',
        changedBy,
      }));
    }
  }
  return created;
}
