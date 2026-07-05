import { Schema, model, Types } from 'mongoose';

export type MediaKind = 'image' | 'video' | 'document';

export interface IMedia {
  owner: Types.ObjectId;
  url: string;
  kind: MediaKind;
  alt?: string;
  originalName?: string;
  mimeType?: string;
}

const MediaSchema = new Schema<IMedia>(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    url: { type: String, required: true },
    kind: { type: String, enum: ['image', 'video', 'document'], default: 'image', index: true },
    alt: String,
    originalName: { type: String, trim: true },
    mimeType: { type: String, trim: true },
  },
  { timestamps: true }
);

export const Media = model<IMedia>('Media', MediaSchema);
