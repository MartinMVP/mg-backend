import { describe, expect, it, vi } from 'vitest';
import { AuctionResult } from '../domain/auctionResults/auctionResult.model';
import { Audit } from '../domain/audit/audit.model';
import { Auction } from '../domain/auctions/auction.model';
import { Notification } from '../domain/notifications/notification.model';
import { createLiveAuction, createTestUser } from '../test/helpers/factories';
import { closeExpiredAuctions } from './auctionScheduler';

function createNamespaceMock() {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));

  return {
    namespace: { to } as any,
    emit,
    to,
  };
}

describe('closeExpiredAuctions', () => {
  it('closes an expired live auction, creates audit, and emits state_changed', async () => {
    const winner = await createTestUser('user');
    const auction = await createLiveAuction({
      endsAt: new Date(Date.now() - 60_000),
      currentPrice: 1500,
      currentWinner: winner._id,
    });
    const { namespace, to, emit } = createNamespaceMock();

    await closeExpiredAuctions(namespace);

    const freshAuction = await Auction.findById(auction._id);
    const audit = await Audit.findOne({
      actor: String(winner._id),
      action: 'AUCTION_AUTO_CLOSE',
    });

    expect(freshAuction?.state).toBe('closed');
    expect(audit).toBeTruthy();
    expect(to).toHaveBeenCalledWith(String(auction._id));
    expect(emit).toHaveBeenCalledWith(
      'state_changed',
      expect.objectContaining({
        auctionId: String(auction._id),
        state: 'closed',
        currentWinner: String(winner._id),
        currentPrice: 1500,
        finalPrice: 1500,
      })
    );
  });

  it('creates an auction result and notifications when an expired auction has a winner', async () => {
    const winner = await createTestUser('user');
    const auction = await createLiveAuction({
      endsAt: new Date(Date.now() - 60_000),
      currentPrice: 1800,
      currentWinner: winner._id,
    });
    const { namespace } = createNamespaceMock();

    await closeExpiredAuctions(namespace);

    const result = await AuctionResult.findOne({ auctionId: auction._id });
    const notifications = await Notification.find({}).sort({ type: 1 });

    expect(result).toBeTruthy();
    expect(String(result?.listingId)).toBe(String(auction.listing));
    expect(String(result?.buyerId)).toBe(String(winner._id));
    expect(result?.finalPrice).toBe(1800);
    expect(result?.status).toBe('pending_contact');

    expect(notifications).toHaveLength(2);
    expect(notifications.map((n) => n.type).sort()).toEqual(['auction_closed', 'auction_won']);
  });

  it('closes an expired live auction without winner and emits currentWinner null', async () => {
    const auction = await createLiveAuction({
      endsAt: new Date(Date.now() - 60_000),
      currentPrice: 1000,
    });
    const { namespace, to, emit } = createNamespaceMock();

    await closeExpiredAuctions(namespace);

    const freshAuction = await Auction.findById(auction._id);
    const audit = await Audit.findOne({
      actor: 'system',
      action: 'AUCTION_AUTO_CLOSE',
    });
    const result = await AuctionResult.findOne({ auctionId: auction._id });

    expect(freshAuction?.state).toBe('closed');
    expect(audit).toBeTruthy();
    expect(result).toBeNull();
    expect(to).toHaveBeenCalledWith(String(auction._id));
    expect(emit).toHaveBeenCalledWith(
      'state_changed',
      expect.objectContaining({
        auctionId: String(auction._id),
        state: 'closed',
        currentWinner: null,
        currentPrice: 1000,
        finalPrice: 1000,
      })
    );
  });

  it('does not change a live auction that has not expired', async () => {
    const auction = await createLiveAuction({
      endsAt: new Date(Date.now() + 60_000),
    });
    const { namespace, emit } = createNamespaceMock();

    await closeExpiredAuctions(namespace);

    const freshAuction = await Auction.findById(auction._id);
    const auditCount = await Audit.countDocuments({ action: 'AUCTION_AUTO_CLOSE' });

    expect(freshAuction?.state).toBe('live');
    expect(auditCount).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });

  it('does not change an auction that is already closed', async () => {
    const auction = await createLiveAuction({
      state: 'closed',
      endsAt: new Date(Date.now() - 60_000),
    });
    const { namespace, emit } = createNamespaceMock();

    await closeExpiredAuctions(namespace);

    const freshAuction = await Auction.findById(auction._id);
    const auditCount = await Audit.countDocuments({ action: 'AUCTION_AUTO_CLOSE' });

    expect(freshAuction?.state).toBe('closed');
    expect(auditCount).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });
});
