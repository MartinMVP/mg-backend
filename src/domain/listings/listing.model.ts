import { Schema, model, Types } from 'mongoose';

export type ListingStatus = 'draft' | 'published' | 'reserved' | 'sold' | 'archived' | 'auction_active' | 'auction_closed';

export interface IListing {
  animal: Types.ObjectId;
  seller: Types.ObjectId;
  price: number;
  currency: 'MXN';
  isNegotiable: boolean;
  featured: boolean;
  status: ListingStatus;
  media: Types.ObjectId[]; // Media ids
}

const ListingSchema = new Schema<IListing>(
  {
    animal: { type: Schema.Types.ObjectId, ref: 'Animal', required: true, index: true },
    seller: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'MXN' },
    isNegotiable: { type: Boolean, default: true },
    featured: { type: Boolean, default: false, index: true },
    status: {
      type: String,
      enum: ['draft', 'published', 'reserved', 'sold', 'archived', 'auction_active', 'auction_closed'],
      default: 'published',
      index: true,
    },
    media: [{ type: Schema.Types.ObjectId, ref: 'Media' }],
  },
  { timestamps: true }
);

// índices útiles para catálogo
ListingSchema.index({ price: 1, createdAt: -1 });
ListingSchema.index({ featured: 1, createdAt: -1 });

export const Listing = model<IListing>('Listing', ListingSchema);
