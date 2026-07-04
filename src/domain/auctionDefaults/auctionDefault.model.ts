import { Schema, model, Types } from 'mongoose';

export const auctionDefaultRoles = ['buyer', 'seller'] as const;
export type AuctionDefaultRole = typeof auctionDefaultRoles[number];

export const auctionDefaultCategories = [
  'buyer_no_response',
  'buyer_refused',
  'seller_no_response',
  'seller_withdrew',
  'seller_outside_sale',
  'fraud',
  'other',
] as const;
export type AuctionDefaultCategory = typeof auctionDefaultCategories[number];

export const auctionDefaultStatuses = ['pending', 'confirmed', 'rejected'] as const;
export type AuctionDefaultStatus = typeof auctionDefaultStatuses[number];

export const auctionDefaultResolutionTypes = [
  'buyer_default',
  'seller_default',
  'no_default',
  'insufficient_evidence',
  'administrative_closure',
] as const;
export type AuctionDefaultResolutionType = typeof auctionDefaultResolutionTypes[number];

export interface IAuctionDefaultReport {
  auctionListingId: Types.ObjectId;
  conversationId: Types.ObjectId;
  reporterUserId: Types.ObjectId;
  reportedUserId: Types.ObjectId;
  role: AuctionDefaultRole;
  category: AuctionDefaultCategory;
  description: string;
  evidence?: unknown;
  status: AuctionDefaultStatus;
  resolutionType?: AuctionDefaultResolutionType;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const auctionDefaultReportSchema = new Schema<IAuctionDefaultReport>(
  {
    auctionListingId: { type: Schema.Types.ObjectId, ref: 'AuctionListing', required: true, index: true },
    conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
    reporterUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reportedUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: auctionDefaultRoles, required: true, index: true },
    category: { type: String, enum: auctionDefaultCategories, required: true, index: true },
    description: { type: String, required: true, trim: true, minlength: 10, maxlength: 2000 },
    evidence: { type: Schema.Types.Mixed },
    status: { type: String, enum: auctionDefaultStatuses, default: 'pending', index: true },
    resolutionType: { type: String, enum: auctionDefaultResolutionTypes },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  { timestamps: true }
);

auctionDefaultReportSchema.index({ auctionListingId: 1, reportedUserId: 1, status: 1 });
auctionDefaultReportSchema.index(
  { auctionListingId: 1, reportedUserId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'confirmed'] } },
  }
);
auctionDefaultReportSchema.index({ createdAt: -1 });

export const AuctionDefaultReport = model<IAuctionDefaultReport>(
  'AuctionDefaultReport',
  auctionDefaultReportSchema
);
