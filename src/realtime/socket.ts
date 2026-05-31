import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { Auction } from '../domain/auctions/auction.model';
import { Bid } from '../domain/auctions/bid.model';
import { Audit } from '../domain/audit/audit.model';

export function initIO(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: env.corsOrigin, credentials: true },
  });

  // Auth por token en handshake
  io.use((socket, next) => {
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

  const nsp = io.of('/auctions');

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

        const next = await Auction.findOneAndUpdate(
          {
            _id: a._id,
            state: 'live',
            currentPrice: a.currentPrice,
            endsAt: { $gt: now },
          },
          {
            $set: {
              currentPrice: payload.amount,
              currentWinner: user.sub,
            },
          },
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

        const secs = Math.floor((next.endsAt.getTime() - now.getTime()) / 1000);

        if (secs <= next.antiSnipingSec && next.antiSnipingCount < next.antiSnipingMaxExt) {
          next.endsAt = new Date(next.endsAt.getTime() + next.antiSnipingExtendSec * 1000);
          next.antiSnipingCount += 1;
          await next.save();

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