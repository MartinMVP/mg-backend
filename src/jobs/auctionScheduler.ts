import { Auction } from '../domain/auctions/auction.model';
import { AuctionResult } from '../domain/auctionResults/auctionResult.model';
import { Audit } from '../domain/audit/audit.model';
import { Listing } from '../domain/listings/listing.model';
import { Notification } from '../domain/notifications/notification.model';
import type { Namespace } from 'socket.io';

export async function closeExpiredAuctions(auctionNamespace?: Namespace) {
  try {
    const now = new Date();

    const expired = await Auction.find({
      state: 'live',
      endsAt: { $lte: now },
    });

    if (!expired.length) return;

    for (const auction of expired) {
      const closedAuction = await Auction.findOneAndUpdate(
        { _id: auction._id, state: 'live', endsAt: { $lte: now } },
        { $set: { state: 'closed' } },
        { new: true }
      );

      if (!closedAuction) continue;

      await Audit.create({
        actor: closedAuction.currentWinner ? String(closedAuction.currentWinner) : 'system',
        action: 'AUCTION_AUTO_CLOSE',
        entity: 'Auction',
        entityId: closedAuction._id,
        payload: {
          winner: closedAuction.currentWinner,
          finalPrice: closedAuction.currentPrice,
        },
      });

      if (closedAuction.currentWinner) {
        const listing = await Listing.findById(closedAuction.listing).select('seller');

        if (listing) {
          await AuctionResult.findOneAndUpdate(
            { auctionId: closedAuction._id },
            {
              $setOnInsert: {
                auctionId: closedAuction._id,
                listingId: closedAuction.listing,
                sellerId: listing.seller,
                buyerId: closedAuction.currentWinner,
                finalPrice: closedAuction.currentPrice,
                closedAt: now,
                status: 'pending_contact',
              },
            },
            { upsert: true, new: true }
          );

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
        }
      }

      auctionNamespace?.to(String(closedAuction._id)).emit('state_changed', {
        auctionId: String(closedAuction._id),
        state: closedAuction.state,
        currentWinner: closedAuction.currentWinner ? String(closedAuction.currentWinner) : null,
        currentPrice: closedAuction.currentPrice,
        finalPrice: closedAuction.currentPrice,
        endsAt: closedAuction.endsAt.toISOString(),
      });

      console.log(
        `🏁 Subasta cerrada: ${closedAuction.title} | Ganador: ${closedAuction.currentWinner || 'N/A'} | Precio: ${closedAuction.currentPrice}`
      );
    }
  } catch (err) {
    console.error('Auction Scheduler Error:', err);
  }
}

export function startAuctionScheduler(auctionNamespace?: Namespace) {
  console.log('⏰ Auction Scheduler iniciado');

  setInterval(() => {
    void closeExpiredAuctions(auctionNamespace);
  }, 60_000);
}
