import { Types } from 'mongoose';
import {
  AuctionDefaultReport,
  AuctionDefaultStatus,
  IAuctionDefaultReport,
} from './auctionDefault.model';

export function createAuctionDefaultReport(input: Partial<IAuctionDefaultReport>) {
  return AuctionDefaultReport.create(input);
}

export function findActiveAuctionDefaultReport(
  auctionListingId: Types.ObjectId,
  reportedUserId: Types.ObjectId
) {
  return AuctionDefaultReport.findOne({
    auctionListingId,
    reportedUserId,
    status: { $in: ['pending', 'confirmed'] },
  });
}

export function findAuctionDefaultReportById(id: Types.ObjectId) {
  return AuctionDefaultReport.findById(id);
}

export function countAuctionDefaultReports(query: Record<string, unknown>) {
  return AuctionDefaultReport.countDocuments(query);
}

export function listAuctionDefaultReports(query: Record<string, unknown>, skip: number, limit: number) {
  return AuctionDefaultReport.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
}

export function countConfirmedDefaultsForUser(userId: Types.ObjectId) {
  return AuctionDefaultReport.countDocuments({
    reportedUserId: userId,
    status: 'confirmed' satisfies AuctionDefaultStatus,
  });
}
