import { Schema, model, Types } from 'mongoose';

export type Sex = 'M' | 'F';
export type AnimalStatus = 'draft' | 'active' | 'archived';

export interface IAnimal {
  owner: Types.ObjectId;
  ownerId?: Types.ObjectId;
  tag: string;
  name?: string;
  breed: Types.ObjectId;
  sex: Sex;
  birthDate?: Date;
  registry?: Types.ObjectId;
  registryId?: string;
  pedigreeUrl?: string;
  weightKg?: number;
  location: { state: string; municipality?: string };
  status?: AnimalStatus;
  isActive: boolean;
  deletedAt?: Date | null;
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
    status: { type: String, enum: ['draft', 'active', 'archived'], default: 'active', index: true },
    isActive: { type: Boolean, default: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

AnimalSchema.virtual('ownerId').get(function () {
  return this.owner;
});
AnimalSchema.index({ tag: 1, owner: 1 }, { unique: true });
AnimalSchema.index({ tag: 'text', name: 'text' });

export const Animal = model<IAnimal>('Animal', AnimalSchema);
