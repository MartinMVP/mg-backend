import { Schema, model } from 'mongoose';

export interface IBreed {
  name: string;
  code: string;
  isActive: boolean;
}

const BreedSchema = new Schema<IBreed>(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Breed = model<IBreed>('Breed', BreedSchema);
