import { Auction } from '../domain/auctions/auction.model';
import { Audit } from '../domain/audit/audit.model';
import { createPostAuctionFlow } from '../domain/auctions/auctionClose.service';
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

      await createPostAuctionFlow(closedAuction, now);

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
