import { Schema, model, Types } from 'mongoose';

export const platformConfigurationEnvironments = ['sandbox', 'production'] as const;
export type PlatformConfigurationEnvironment = typeof platformConfigurationEnvironments[number];

export const platformConfigurationValueTypes = ['string', 'number', 'boolean', 'json'] as const;
export type PlatformConfigurationValueType = typeof platformConfigurationValueTypes[number];

export interface IPlatformConfiguration {
  key: string;
  environment: PlatformConfigurationEnvironment;
  version: number;
  valueType: PlatformConfigurationValueType;
  value: unknown;
  description?: string;
  isProtected?: boolean;
  createdBy: Types.ObjectId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function matchesValueType(valueType: PlatformConfigurationValueType, value: unknown) {
  if (valueType === 'string') return typeof value === 'string';
  if (valueType === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (valueType === 'boolean') return typeof value === 'boolean';
  if (valueType === 'json') return value !== null && typeof value === 'object';
  return false;
}

const platformConfigurationSchema = new Schema<IPlatformConfiguration>(
  {
    key: { type: String, required: true, trim: true, index: true },
    environment: { type: String, enum: platformConfigurationEnvironments, required: true, index: true },
    version: { type: Number, required: true, min: 1 },
    valueType: { type: String, enum: platformConfigurationValueTypes, required: true },
    value: {
      type: Schema.Types.Mixed,
      required: true,
      validate: {
        validator(this: IPlatformConfiguration, value: unknown) {
          return matchesValueType(this.valueType, value);
        },
        message: 'platform_configuration_value_type_mismatch',
      },
    },
    description: { type: String, trim: true, maxlength: 500 },
    isProtected: { type: Boolean },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

platformConfigurationSchema.pre('validate', function () {
  if (!this.key || !this.key.trim()) {
    this.invalidate('key', 'platform_configuration_key_required');
  }
});

platformConfigurationSchema.index({ key: 1, environment: 1, version: 1 }, { unique: true });
platformConfigurationSchema.index(
  { key: 1, environment: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

export const PlatformConfiguration = model<IPlatformConfiguration>(
  'PlatformConfiguration',
  platformConfigurationSchema
);
