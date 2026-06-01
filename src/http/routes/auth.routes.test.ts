import request from 'supertest';
import bcrypt from 'bcryptjs';
import { describe, expect, it } from 'vitest';
import app from '../../app';
import { Session } from '../../domain/sessions/session.model';
import { User } from '../../domain/users/user.model';

const credentials = {
  email: 'new-user@mg.test',
  password: 'P4ssw0rd!',
  name: 'New User',
};

function getCookieValue(headers: string | string[] | undefined, name: string) {
  const values = Array.isArray(headers) ? headers : headers ? [headers] : [];
  const cookie = values.find((value) => value.startsWith(`${name}=`));
  return cookie?.split(';')[0].slice(name.length + 1);
}

describe('auth routes', () => {
  it('registers a user without exposing password', async () => {
    const res = await request(app).post('/auth/register').send(credentials).expect(201);

    expect(res.body).toMatchObject({
      email: credentials.email,
      name: credentials.name,
    });
    expect(res.body.password).toBeUndefined();
  });

  it('stores password hashed once after register', async () => {
    await request(app).post('/auth/register').send(credentials).expect(201);

    const user = await User.findOne({ email: credentials.email }).select('password').lean();

    expect(user?.password).toBeTruthy();
    expect(user?.password).not.toBe(credentials.password);
    expect(await bcrypt.compare(credentials.password, user?.password || '')).toBe(true);
    expect(await bcrypt.compare(credentials.password, await bcrypt.hash(user?.password || '', 10))).toBe(false);
  });

  it('allows login immediately after register', async () => {
    await request(app).post('/auth/register').send(credentials).expect(201);

    const res = await request(app)
      .post('/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);

    expect(res.body.access).toEqual(expect.any(String));
    expect(getCookieValue(res.headers['set-cookie'], 'mg_refresh')).toBeTruthy();
    expect(getCookieValue(res.headers['set-cookie'], 'mg_csrf')).toBeTruthy();
  });

  it('rejects incorrect password', async () => {
    await request(app).post('/auth/register').send(credentials).expect(201);

    await request(app)
      .post('/auth/login')
      .send({ email: credentials.email, password: 'wrong-password' })
      .expect(401);
  });

  it('rotates refresh token when CSRF token is valid', async () => {
    await request(app).post('/auth/register').send(credentials).expect(201);

    const login = await request(app)
      .post('/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);

    const csrf = getCookieValue(login.headers['set-cookie'], 'mg_csrf');
    const refresh = getCookieValue(login.headers['set-cookie'], 'mg_refresh');

    const res = await request(app)
      .post('/auth/refresh')
      .set('Cookie', [`mg_csrf=${csrf}`, `mg_refresh=${refresh}`])
      .set('x-csrf', csrf || '')
      .expect(200);

    expect(res.body.access).toEqual(expect.any(String));
    expect(await Session.countDocuments({ isRevoked: false })).toBe(1);
    expect(await Session.countDocuments({ isRevoked: true })).toBe(1);
  });

  it('logs out and revokes active sessions', async () => {
    await request(app).post('/auth/register').send(credentials).expect(201);

    const login = await request(app)
      .post('/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(200);

    const csrf = getCookieValue(login.headers['set-cookie'], 'mg_csrf');
    const refresh = getCookieValue(login.headers['set-cookie'], 'mg_refresh');

    await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${login.body.access}`)
      .set('Cookie', [`mg_csrf=${csrf}`, `mg_refresh=${refresh}`])
      .set('x-csrf', csrf || '')
      .expect(200);

    expect(await Session.countDocuments({ isRevoked: false })).toBe(0);
  });
});
