import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Notification } from '../../domain/notifications/notification.model';

export async function listNotifications(req: Request, res: Response) {
  const user = (req as any).user;

  const items = await Notification.find({ userId: user.sub })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  res.json(items);
}

export async function markNotificationRead(req: Request, res: Response) {
  const user = (req as any).user;
  const id = String(req.params.id);

  if (!Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid notification id' });
  }

  const doc = await Notification.findOneAndUpdate(
    { _id: id, userId: user.sub },
    { $set: { read: true } },
    { new: true }
  );

  if (!doc) return res.status(404).json({ error: 'Not found' });

  res.json(doc);
}
