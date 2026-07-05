import { Schema, model, Types } from 'mongoose';

export type MediaReferenceType = 'image' | 'document' | 'video';

export interface IMediaReference {
  mediaId: Types.ObjectId;
  ownerId: Types.ObjectId;
  type: MediaReferenceType;
  createdAt: Date;
  updatedAt: Date;
}

const MediaReferenceSchema = new Schema<IMediaReference>(
  {
    mediaId: { type: Schema.Types.ObjectId, ref: 'Media', required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['image', 'document', 'video'], required: true, index: true },
  },
  { timestamps: true }
);

MediaReferenceSchema.index({ mediaId: 1, ownerId: 1 }, { unique: true });

export const MediaReference = model<IMediaReference>('MediaReference', MediaReferenceSchema);
