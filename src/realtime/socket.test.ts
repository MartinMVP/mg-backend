import { describe, expect, it, vi } from 'vitest';
import { Auction } from '../domain/auctions/auction.model';
import { Bid } from '../domain/auctions/bid.model';
import { createLiveAuction } from '../test/helpers/factories';
import { rejectInvalidAuctionBidAmount } from './socket';

function createSocketMock() {
  return {
    emit: vi.fn(),
  };
}

describe('rejectInvalidAuctionBidAmount', () => {
  it.each(['abc', 'NaN', 'Infinity', 0, -10])(
    'emits bid_rejected and does not mutate auction for invalid amount %s',
    async (amount) => {
      const auction = await createLiveAuction({
        currentPrice: 1000,
        minIncrement: 100,
      });
      const socket = createSocketMock();

      const parsedAmount = rejectInvalidAuctionBidAmount(
        { auctionId: String(auction._id), amount },
        socket
      );

      expect(parsedAmount).toBeNull();
      expect(socket.emit).toHaveBeenCalledWith('bid_rejected', {
        auctionId: String(auction._id),
        error: 'Invalid bid amount',
      });

      const bidCount = await Bid.countDocuments({ auction: auction._id });
      const freshAuction = await Auction.findById(auction._id);

      expect(bidCount).toBe(0);
      expect(freshAuction?.state).toBe('live');
      expect(freshAuction?.currentPrice).toBe(1000);
      expect(freshAuction?.currentWinner).toBeUndefined();
    }
  );
});
