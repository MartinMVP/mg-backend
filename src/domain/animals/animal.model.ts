import { Schema, model, Types } from 'mongoose';

export type Sex = 'M' | 'F';

export interface IAnimal {
  owner: Types.ObjectId;
  tag: string;            // arete/identificador
  name?: string;
  breed: Types.ObjectId;  // ref -> Breed
  sex: Sex;
  birthDate?: Date;
  registry?: Types.ObjectId;  // ref -> Registry
  registryId?: string;        // número de registro
  pedigreeUrl?: string;
  weightKg?: number;
  location: { state: string; municipality?: string };
  isActive: boolean;
  deletedAt?: Date | null;    // soft delete
}

const AnimalSchema = new Schema<IAnimal>(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    tag: { type: String, required: true, index: true, trim: true },
    name: { type: String, trim: true },
    breed: { type: Schema.Types.ObjectId, ref: 'Breed', required: true, index: true },
    sex: { type: String, enum: ['M', 'F'], required: true, index: true },
    birthDate: Date,
    registry: { type: Schema.Types.ObjectId, ref: 'Registry' },
    registryId: String,
    pedigreeUrl: String,
    weightKg: Number,
    location: {
      state: { type: String, required: true, trim: true },
      municipality: { type: String, trim: true },
    },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

AnimalSchema.index({ tag: 1, owner: 1 }, { unique: true });
// búsqueda rápida por texto básico
AnimalSchema.index({ tag: 'text', name: 'text' });

export const Animal = model<IAnimal>('Animal', AnimalSchema);
