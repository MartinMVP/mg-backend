import { AuctionResult } from '../auctionResults/auctionResult.model';
import { Notification } from '../notifications/notification.model';
import { Listing } from '../listings/listing.model';

export async function createPostAuctionFlow(closedAuction: any, closedAt = new Date()) {
  if (!closedAuction.currentWinner) {
    return { result: null, created: false };
  }

  const listing = await Listing.findById(closedAuction.listing).select('seller');
  if (!listing) {
    return { result: null, created: false };
  }

  try {
    const result = await AuctionResult.create({
      auctionId: closedAuction._id,
      listingId: closedAuction.listing,
      sellerId: listing.seller,
      buyerId: closedAuction.currentWinner,
      finalPrice: closedAuction.currentPrice,
      closedAt,
      status: 'pending_contact',
    });

    await Notification.create([
      {
        userId: closedAuction.currentWinner,
        type: 'auction_won',
        title: 'Subasta ganada',
        message: `Ganaste la subasta ${closedAuction.title} por ${closedAuction.currentPrice}.`,
      },
      {
        userId: listing.seller,
        type: 'auction_closed',
        title: 'Subasta cerrada',
        message: `Tu subasta ${closedAuction.title} cerró por ${closedAuction.currentPrice}.`,
      },
    ]);

    return { result, created: true };
  } catch (err: any) {
    if (err?.code === 11000) {
      const result = await AuctionResult.findOne({ auctionId: closedAuction._id });
      return { result, created: false };
    }

    throw err;
  }
}
