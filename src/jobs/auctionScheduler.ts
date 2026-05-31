import { Auction } from '../domain/auctions/auction.model';
import { Audit } from '../domain/audit/audit.model';
import type { Namespace } from 'socket.io';

export function startAuctionScheduler(auctionNamespace?: Namespace) {
  console.log('⏰ Auction Scheduler iniciado');

  setInterval(async () => {
    try {
      const now = new Date();

      const expired = await Auction.find({
        state: 'live',
        endsAt: { $lte: now },
      });

      if (!expired.length) return;

      for (const auction of expired) {
        auction.state = 'closed';
        await auction.save();

        await Audit.create({
          actor: auction.currentWinner || null,
          action: 'AUCTION_AUTO_CLOSE',
          entity: 'Auction',
          entityId: auction._id,
          payload: {
            winner: auction.currentWinner,
            finalPrice: auction.currentPrice,
          },
        });

        auctionNamespace?.to(String(auction._id)).emit('state_changed', {
          auctionId: String(auction._id),
          state: auction.state,
          currentWinner: auction.currentWinner ? String(auction.currentWinner) : null,
          currentPrice: auction.currentPrice,
          finalPrice: auction.currentPrice,
          endsAt: auction.endsAt.toISOString(),
        });

        console.log(
          `🏁 Subasta cerrada: ${auction.title} | Ganador: ${auction.currentWinner || 'N/A'} | Precio: ${auction.currentPrice}`
        );
      }
    } catch (err) {
      console.error('Auction Scheduler Error:', err);
    }
  }, 60_000);
}