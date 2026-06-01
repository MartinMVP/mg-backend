import { describe, expect, it } from 'vitest';
import { getCsrfAllowedOrigins, isAllowedCsrfOrigin } from './csrf';

describe('CSRF origin validation', () => {
  const allowedOrigins = [
    'https://mg-frontend.onrender.com',
    'https://beta.mercadoganadero.mx',
    'http://localhost:5173',
  ];

  it('parses comma and semicolon separated allowed origins', () => {
    expect(
      getCsrfAllowedOrigins({
        CORS_ORIGIN: 'https://mg-frontend.onrender.com; http://localhost:5173,https://beta.mercadoganadero.mx',
      })
    ).toEqual([
      'https://mg-frontend.onrender.com',
      'http://localhost:5173',
      'https://beta.mercadoganadero.mx',
    ]);
  });

  it('allows exact origin matches', () => {
    expect(isAllowedCsrfOrigin('https://mg-frontend.onrender.com', allowedOrigins)).toBe(true);
    expect(isAllowedCsrfOrigin('http://localhost:5173', allowedOrigins)).toBe(true);
  });

  it('rejects prefix-based origin matches', () => {
    expect(isAllowedCsrfOrigin('https://mg-frontend.onrender.com.evil.example', allowedOrigins)).toBe(false);
    expect(isAllowedCsrfOrigin('http://localhost:51730', allowedOrigins)).toBe(false);
  });

  it('validates referer by exact origin', () => {
    expect(isAllowedCsrfOrigin('https://mg-frontend.onrender.com/account', allowedOrigins, true)).toBe(true);
    expect(isAllowedCsrfOrigin('https://mg-frontend.onrender.com.evil.example/account', allowedOrigins, true)).toBe(false);
  });

  it('rejects malformed referers', () => {
    expect(isAllowedCsrfOrigin('not a url', allowedOrigins, true)).toBe(false);
  });
});
