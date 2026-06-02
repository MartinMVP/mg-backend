import fs from 'fs/promises';
import path from 'path';
import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Media } from '../../domain/media/media.model';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createTestUser } from '../../test/helpers/factories';

describe('media upload security', () => {
  let app: typeof import('../../app').default;
  const createdFiles: string[] = [];

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  afterEach(async () => {
    await Promise.all(
      createdFiles.splice(0).map((filePath) => fs.unlink(filePath).catch(() => undefined))
    );
  });

  async function auth() {
    const user = await createTestUser('user');
    return createAccessToken(user._id, 'user');
  }

  it('accepts a valid image extension and mimetype', async () => {
    const token = await auth();

    const res = await request(app)
      .post('/api/media')
      .set('Authorization', bearer(token))
      .attach('file', Buffer.from('not-real-image-but-valid-upload-contract'), {
        filename: 'foto ganado.png',
        contentType: 'image/png',
      });

    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/^\/files\/.+\.png$/);
    expect(res.body.url).not.toContain(' ');
    expect(res.body.url).not.toContain('..');
    createdFiles.push(path.resolve('uploads', path.basename(res.body.url)));

    const stored = await Media.findById(res.body._id);
    expect(stored).toBeTruthy();
    expect(stored?.kind).toBe('image');
  });

  it('rejects an invalid mimetype even with a valid extension', async () => {
    const token = await auth();

    const res = await request(app)
      .post('/api/media')
      .set('Authorization', bearer(token))
      .attach('file', Buffer.from('plain text'), {
        filename: 'foto.png',
        contentType: 'text/plain',
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid file mimetype' });
    expect(await Media.countDocuments()).toBe(0);
  });

  it('rejects an invalid extension even with a valid image mimetype', async () => {
    const token = await auth();

    const res = await request(app)
      .post('/api/media')
      .set('Authorization', bearer(token))
      .attach('file', Buffer.from('image-ish'), {
        filename: 'foto.exe',
        contentType: 'image/png',
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid file type' });
    expect(await Media.countDocuments()).toBe(0);
  });
});
