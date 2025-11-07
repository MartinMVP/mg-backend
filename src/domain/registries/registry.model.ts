import { Schema, model } from 'mongoose';

export interface IRegistry {
  name: string;
  authority: string;
  country?: string;
  isActive: boolean;
}

const RegistrySchema = new Schema<IRegistry>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    authority: { type: String, required: true, trim: true },
    country: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Registry = model<IRegistry>('Registry', RegistrySchema);
