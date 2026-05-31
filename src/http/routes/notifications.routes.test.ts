import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Notification } from '../../domain/notifications/notification.model';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createTestUser } from '../../test/helpers/factories';

describe('notifications routes', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  it('lists only notifications for the authenticated user', async () => {
    const user = await createTestUser('user');
    const other = await createTestUser('user');
    const token = createAccessToken(String(user._id), 'user');

    await Notification.create([
      {
        userId: user._id,
        type: 'auction_won',
        title: 'Ganaste',
        message: 'Ganaste una subasta.',
      },
      {
        userId: other._id,
        type: 'auction_closed',
        title: 'Otra',
        message: 'Notificacion de otro usuario.',
      },
    ]);

    const res = await request(app)
      .get('/notifications')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      userId: String(user._id),
      type: 'auction_won',
      read: false,
    });
  });

  it('marks a notification as read only when it belongs to the authenticated user', async () => {
    const user = await createTestUser('user');
    const other = await createTestUser('user');
    const token = createAccessToken(String(user._id), 'user');

    const ownNotification = await Notification.create({
      userId: user._id,
      type: 'auction_won',
      title: 'Ganaste',
      message: 'Ganaste una subasta.',
    });
    const otherNotification = await Notification.create({
      userId: other._id,
      type: 'auction_closed',
      title: 'Otra',
      message: 'Notificacion de otro usuario.',
    });

    const ownRes = await request(app)
      .post(`/notifications/${ownNotification._id}/read`)
      .set('Authorization', bearer(token));

    expect(ownRes.status).toBe(200);
    expect(ownRes.body.read).toBe(true);

    const otherRes = await request(app)
      .post(`/notifications/${otherNotification._id}/read`)
      .set('Authorization', bearer(token));

    const freshOther = await Notification.findById(otherNotification._id);

    expect(otherRes.status).toBe(404);
    expect(freshOther?.read).toBe(false);
  });

  it('returns 400 for an invalid notification ObjectId', async () => {
    const user = await createTestUser('user');
    const token = createAccessToken(String(user._id), 'user');

    const res = await request(app)
      .post('/notifications/not-an-object-id/read')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid notification id' });
  });

  it('does not mark another user notification as read', async () => {
    const user = await createTestUser('user');
    const other = await createTestUser('user');
    const token = createAccessToken(String(user._id), 'user');

    const otherNotification = await Notification.create({
      userId: other._id,
      type: 'auction_closed',
      title: 'Otra',
      message: 'Notificacion de otro usuario.',
    });

    const res = await request(app)
      .post(`/notifications/${otherNotification._id}/read`)
      .set('Authorization', bearer(token));

    const freshOther = await Notification.findById(otherNotification._id);

    expect(res.status).toBe(404);
    expect(freshOther?.read).toBe(false);
  });
});
