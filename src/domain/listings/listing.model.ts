import { Schema, model, Types } from 'mongoose';

export type ListingStatus =
  | 'draft'
  | 'pending_review'
  | 'published'
  | 'rejected'
  | 'archived'
  | 'reserved'
  | 'sold'
  | 'auction_active'
  | 'auction_closed';

export interface IListing {
  animal: Types.ObjectId;
  animalId?: Types.ObjectId;
  seller: Types.ObjectId;
  sellerId?: Types.ObjectId;
  title?: string;
  description?: string;
  price: number;
  currency: 'MXN';
  isNegotiable: boolean;
  featured: boolean;
  status: ListingStatus;
  media: Types.ObjectId[];
  publishedAt?: Date;
  archivedAt?: Date;
}

const ListingSchema = new Schema<IListing>(
  {
    animal: { type: Schema.Types.ObjectId, ref: 'Animal', required: true, index: true },
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, trim: true, maxlength: 160 },
    description: { type: String, trim: true, maxlength: 4000 },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['MXN'], default: 'MXN' },
    isNegotiable: { type: Boolean, default: true },
    featured: { type: Boolean, default: false, index: true },
    status: {
      type: String,
      enum: ['draft', 'pending_review', 'published', 'rejected', 'archived', 'reserved', 'sold', 'auction_active', 'auction_closed'],
      default: 'published',
      index: true,
    },
    media: [{ type: Schema.Types.ObjectId, ref: 'Media' }],
    publishedAt: { type: Date, index: true },
    archivedAt: { type: Date, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

ListingSchema.virtual('animalId').get(function () {
  return this.animal;
});
ListingSchema.virtual('sellerId').get(function () {
  return this.seller;
});
ListingSchema.index({ price: 1, createdAt: -1 });
ListingSchema.index({ featured: 1, createdAt: -1 });
ListingSchema.index({ seller: 1, animal: 1, status: 1 });

export const Listing = model<IListing>('Listing', ListingSchema);
