import { Schema, model, Types } from 'mongoose';
import {
  KnowledgeDomain,
  KnowledgeGeneratedBy,
  KnowledgeProvenance,
  KnowledgeSourceEvidence,
  KnowledgeSourceType,
  knowledgeDomains,
  knowledgeGeneratedBy,
  knowledgeSourceTypes,
} from './knowledge.types';

export interface IKnowledgeRecord {
  knowledgeDomain: KnowledgeDomain;
  knowledgeType: string;
  sourceType: KnowledgeSourceType;
  sourceId?: Types.ObjectId | string | null;
  facts: Record<string, unknown>;
  context: Record<string, unknown>;
  provenance: KnowledgeProvenance;
  version: number;
  createdAt: Date;
}

const knowledgeSourceEvidenceSchema = new Schema<KnowledgeSourceEvidence>(
  {
    sourceType: { type: String, enum: knowledgeSourceTypes, required: true },
    sourceId: { type: Schema.Types.Mixed, default: null },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { _id: false }
);

const knowledgeProvenanceSchema = new Schema<KnowledgeProvenance>(
  {
    generatedBy: { type: String, enum: knowledgeGeneratedBy, required: true },
    sourceEvidence: { type: [knowledgeSourceEvidenceSchema], default: [] },
    rulesVersion: { type: String, default: null },
    engineVersion: { type: String, default: null },
    validatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, required: true },
    validatedAt: { type: Date, default: null },
    approvedAt: { type: Date, default: null },
  },
  { _id: false }
);

const knowledgeRecordSchema = new Schema<IKnowledgeRecord>(
  {
    knowledgeDomain: { type: String, enum: knowledgeDomains, required: true, index: true },
    knowledgeType: { type: String, required: true, trim: true, maxlength: 200, index: true },
    sourceType: { type: String, enum: knowledgeSourceTypes, required: true, index: true },
    sourceId: { type: Schema.Types.Mixed, default: null, index: true },
    facts: { type: Schema.Types.Mixed, required: true },
    context: { type: Schema.Types.Mixed, default: {} },
    provenance: { type: knowledgeProvenanceSchema, required: true },
    version: { type: Number, required: true, min: 1, default: 1, index: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

knowledgeRecordSchema.index({ knowledgeDomain: 1, knowledgeType: 1, version: -1 });
knowledgeRecordSchema.index({ createdAt: -1 });

export const KnowledgeRecord = model<IKnowledgeRecord>('KnowledgeRecord', knowledgeRecordSchema);
