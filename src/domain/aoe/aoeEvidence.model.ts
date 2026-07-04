import { Schema, model, Types } from 'mongoose';

export const aoeEvidenceSourceTypes = [
  'audit',
  'messaging',
  'auction',
  'sanction',
  'appeal',
  'listing',
  'membership',
  'revenue',
  'notification',
  'platform_configuration',
] as const;
export type AOEEvidenceSourceType = typeof aoeEvidenceSourceTypes[number];

export interface IAOEEvidence {
  aoeCaseId: Types.ObjectId;
  sourceType: AOEEvidenceSourceType;
  sourceId: Types.ObjectId;
  summary: string;
  metadata?: unknown;
  confidence: number;
  createdAt: Date;
}

const aoeEvidenceSchema = new Schema<IAOEEvidence>(
  {
    aoeCaseId: { type: Schema.Types.ObjectId, ref: 'AOECase', required: true, index: true },
    sourceType: { type: String, enum: aoeEvidenceSourceTypes, required: true, index: true },
    sourceId: { type: Schema.Types.ObjectId, required: true, index: true },
    summary: { type: String, required: true, trim: true, maxlength: 2000 },
    metadata: { type: Schema.Types.Mixed },
    confidence: { type: Number, required: true, min: 0, max: 100 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

function rejectAppendOnly(next: (error?: Error) => void) {
  next(new Error('aoe_evidence_append_only'));
}

aoeEvidenceSchema.pre('updateOne', rejectAppendOnly);
aoeEvidenceSchema.pre('findOneAndUpdate', rejectAppendOnly);
aoeEvidenceSchema.pre('updateMany', rejectAppendOnly);
aoeEvidenceSchema.pre('deleteOne', rejectAppendOnly);
aoeEvidenceSchema.pre('deleteMany', rejectAppendOnly);
aoeEvidenceSchema.pre('findOneAndDelete', rejectAppendOnly);

aoeEvidenceSchema.index({ aoeCaseId: 1, createdAt: -1 });
aoeEvidenceSchema.index({ sourceType: 1, sourceId: 1 });

export const AOEEvidence = model<IAOEEvidence>('AOEEvidence', aoeEvidenceSchema);
