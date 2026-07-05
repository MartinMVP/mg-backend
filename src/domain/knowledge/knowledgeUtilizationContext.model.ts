import { Schema, model } from 'mongoose';

export interface IKnowledgeUtilizationContext {
  consumer: Record<string, unknown>;
  domain: string;
  objective: string;
  constraints: Record<string, unknown>;
  requestedKnowledge: Record<string, unknown>;
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const knowledgeUtilizationContextSchema = new Schema<IKnowledgeUtilizationContext>(
  {
    consumer: { type: Schema.Types.Mixed, required: true },
    domain: { type: String, required: true, trim: true, maxlength: 200, index: true },
    objective: { type: String, required: true, trim: true, maxlength: 1000 },
    constraints: { type: Schema.Types.Mixed, default: {} },
    requestedKnowledge: { type: Schema.Types.Mixed, default: {} },
    generatedAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

export const KnowledgeUtilizationContext = model<IKnowledgeUtilizationContext>(
  'KnowledgeUtilizationContext',
  knowledgeUtilizationContextSchema
);
