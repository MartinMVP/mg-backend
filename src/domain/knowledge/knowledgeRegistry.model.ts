import { Schema, model, Types } from 'mongoose';
import {
  KnowledgeDomain,
  KnowledgeLocation,
  KnowledgeStorageType,
  knowledgeDomains,
  knowledgeStorageTypes,
} from './knowledge.types';

export interface IKnowledgeRegistry {
  knowledgeRecordId: Types.ObjectId;
  knowledgeDomain: KnowledgeDomain;
  knowledgeType: string;
  version: number;
  producer: string;
  location: KnowledgeLocation;
  createdAt: Date;
}

const knowledgeLocationSchema = new Schema<KnowledgeLocation>(
  {
    storageType: { type: String, enum: knowledgeStorageTypes, required: true },
    reference: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { _id: false }
);

const knowledgeRegistrySchema = new Schema<IKnowledgeRegistry>(
  {
    knowledgeRecordId: { type: Schema.Types.ObjectId, ref: 'KnowledgeRecord', required: true, unique: true, index: true },
    knowledgeDomain: { type: String, enum: knowledgeDomains, required: true, index: true },
    knowledgeType: { type: String, required: true, trim: true, maxlength: 200, index: true },
    version: { type: Number, required: true, min: 1, index: true },
    producer: { type: String, required: true, trim: true, maxlength: 200, index: true },
    location: { type: knowledgeLocationSchema, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

knowledgeRegistrySchema.index({ knowledgeDomain: 1, knowledgeType: 1, version: -1 });
knowledgeRegistrySchema.index({ createdAt: -1 });

export const KnowledgeRegistry = model<IKnowledgeRegistry>('KnowledgeRegistry', knowledgeRegistrySchema);
