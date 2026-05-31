import { describe, expect, it, vi } from 'vitest';
import { Audit } from '../domain/audit/audit.model';
import { Auction } from '../domain/auctions/auction.model';
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

    expect(freshAuction?.state).toBe('closed');
    expect(audit).toBeTruthy();
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
