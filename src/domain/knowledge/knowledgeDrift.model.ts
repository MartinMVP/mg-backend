import { Schema, model, Types } from 'mongoose';
import { DriftSeverity, DriftType, driftSeverities, driftTypes } from './knowledgeValidation.types';

export interface IKnowledgeDrift {
  tenantId: string;
  assetId: Types.ObjectId;
  driftType: DriftType;
  driftDetected: boolean;
  previousScore: number;
  currentScore: number;
  severity: DriftSeverity;
  createdAt: Date;
}

const knowledgeDriftSchema = new Schema<IKnowledgeDrift>(
  {
    tenantId: { type: String, required: true, default: 'default', index: true },
    assetId: { type: Schema.Types.ObjectId, ref: 'KnowledgeAsset', required: true, index: true },
    driftType: { type: String, enum: driftTypes, required: true, index: true },
    driftDetected: { type: Boolean, required: true, index: true },
    previousScore: { type: Number, min: 0, max: 100, required: true },
    currentScore: { type: Number, min: 0, max: 100, required: true },
    severity: { type: String, enum: driftSeverities, required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

export const KnowledgeDrift = model<IKnowledgeDrift>('KnowledgeDrift', knowledgeDriftSchema);
