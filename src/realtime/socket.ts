import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { Auction } from '../domain/auctions/auction.model';
import { Bid } from '../domain/auctions/bid.model';
import { Audit } from '../domain/audit/audit.model';

let auctionNamespace: ReturnType<Server['of']> | null = null;

export function emitAuctionStateChanged(auctionId: string, payload: any) {
  auctionNamespace?.to(auctionId).emit('state_changed', payload);
}

export function initIO(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.corsOrigin, credentials: true },
  });

  const nsp = io.of('/auctions');
  auctionNamespace = nsp;

  // Auth por token en handshake del namespace real de subastas.
  nsp.use((socket, next) => {
    const hdr = socket.handshake.auth?.token || socket.handshake.headers['authorization'];
    const token = typeof hdr === 'string' ? hdr.replace(/^Bearer\s+/i, '') : '';

    if (!token) return next(new Error('Unauthorized'));

    try {
      const user = jwt.verify(token, env.jwtAccessSecret);
      (socket as any).user = user;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  nsp.on('connection', (socket) => {
    const user = (socket as any).user;

    socket.on('join', (auctionId: string) => {
      socket.join(auctionId);
    });

    socket.on('leave', (auctionId: string) => {
      socket.leave(auctionId);
    });

    socket.on('place_bid', async (payload: { auctionId: string; amount: number }) => {
      try {
        const now = new Date();

        const a = await Auction.findOne({
          _id: payload.auctionId,
          state: 'live',
          endsAt: { $gt: now },
        });

        if (!a) {
          return socket.emit('bid_rejected', {
            auctionId: payload.auctionId,
            error: 'Auction not live',
          });
        }

        const min = a.currentPrice + a.minIncrement;

        if (payload.amount < min) {
          await Audit.create({
            actor: user?.sub,
            action: 'BID_REJECTED',
            entity: 'Auction',
            entityId: a._id,
            payload: { reason: 'low', amount: payload.amount },
          });

          return socket.emit('bid_rejected', {
            auctionId: payload.auctionId,
            error: 'Bid too low',
            min,
          });
        }

        const secs = Math.floor((a.endsAt.getTime() - now.getTime()) / 1000);
        const shouldExtend =
          secs <= a.antiSnipingSec && a.antiSnipingCount < a.antiSnipingMaxExt;
        const extendedEndsAt = shouldExtend
          ? new Date(a.endsAt.getTime() + a.antiSnipingExtendSec * 1000)
          : null;
        const bidNow = new Date();

        const bidFilter: any = {
          _id: a._id,
          state: 'live',
          currentPrice: a.currentPrice,
        };

        const bidUpdate: any = {
          $set: {
            currentPrice: payload.amount,
            currentWinner: user.sub,
          },
        };

        if (shouldExtend && extendedEndsAt) {
          bidFilter.endsAt = { $eq: a.endsAt, $gt: bidNow };
          bidFilter.antiSnipingCount = a.antiSnipingCount;
          bidUpdate.$set.endsAt = extendedEndsAt;
          bidUpdate.$inc = { antiSnipingCount: 1 };
        } else {
          bidFilter.endsAt = { $gt: bidNow };
        }

        const next = await Auction.findOneAndUpdate(
          bidFilter,
          bidUpdate,
          { new: true }
        );

        if (!next) {
          return socket.emit('bid_rejected', {
            auctionId: payload.auctionId,
            error: 'Race condition',
          });
        }

        const bid = await Bid.create({
          auction: next._id,
          listing: next.listing,
          bidder: user.sub,
          amount: payload.amount,
        });

        if (shouldExtend && extendedEndsAt) {
          nsp.to(String(next._id)).emit('state_changed', {
            auctionId: String(next._id),
            state: next.state,
            endsAt: next.endsAt.toISOString(),
          });
        }

        await Audit.create({
          actor: user?.sub,
          action: 'BID_ACCEPTED',
          entity: 'Auction',
          entityId: next._id,
          payload: { amount: payload.amount },
        });

        nsp.to(String(next._id)).emit('bid_accepted', {
          auctionId: String(next._id),
          user: user.sub,
          amount: payload.amount,
          currentPrice: next.currentPrice,
          bid: {
            _id: String(bid._id),
            auction: String(next._id),
            listing: String(next.listing),
            bidder: user.sub,
            amount: payload.amount,
            createdAt: bid.createdAt,
          },
        });
      } catch (e: any) {
        socket.emit('bid_rejected', {
          auctionId: payload.auctionId,
          error: e?.message || 'Error',
        });
      }
    });
  });

  return io;
}
