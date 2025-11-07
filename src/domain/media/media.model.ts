import { Schema, model, Types } from 'mongoose';

export interface IMedia {
  owner: Types.ObjectId;
  url: string;
  kind: 'image' | 'video';
  alt?: string;
}

const MediaSchema = new Schema<IMedia>(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    url: { type: String, required: true },
    kind: { type: String, enum: ['image', 'video'], default: 'image' },
    alt: String,
  },
  { timestamps: true }
);

export const Media = model<IMedia>('Media', MediaSchema);
