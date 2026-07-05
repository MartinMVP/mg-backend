import { Schema, model, Types } from 'mongoose';
import {
  KnowledgeCollectionType,
  knowledgeCollectionTypes,
} from './knowledge.types';

export interface IKnowledgeCollection {
  collectionType: KnowledgeCollectionType;
  title: string;
  description: string;
  knowledgeRecords: Types.ObjectId[];
  ownerDomain: string;
  knowledgeSteward: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const knowledgeCollectionSchema = new Schema<IKnowledgeCollection>(
  {
    collectionType: { type: String, enum: knowledgeCollectionTypes, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    knowledgeRecords: [{ type: Schema.Types.ObjectId, ref: 'KnowledgeRecord', required: true }],
    ownerDomain: { type: String, required: true, trim: true, maxlength: 200, index: true },
    knowledgeSteward: { type: String, required: true, trim: true, maxlength: 200, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

knowledgeCollectionSchema.index({ ownerDomain: 1, collectionType: 1, createdAt: -1 });
knowledgeCollectionSchema.index({ createdAt: -1 });

export const KnowledgeCollection = model<IKnowledgeCollection>('KnowledgeCollection', knowledgeCollectionSchema);
