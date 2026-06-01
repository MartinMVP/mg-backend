import { describe, expect, it } from 'vitest';
import { isAllowedOrigin } from './security';

describe('CORS origin validation', () => {
  const allowlist = [
    'https://mg-frontend.onrender.com',
    'https://beta.mercadoganadero.mx',
    'http://localhost:5173',
  ];

  it('allows exact origins', () => {
    expect(isAllowedOrigin('https://mg-frontend.onrender.com', allowlist)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', allowlist)).toBe(true);
  });

  it('rejects prefix-based origin matches', () => {
    expect(isAllowedOrigin('https://mg-frontend.onrender.com.evil.example', allowlist)).toBe(false);
    expect(isAllowedOrigin('http://localhost:51730', allowlist)).toBe(false);
  });

  it('rejects missing origins', () => {
    expect(isAllowedOrigin(undefined, allowlist)).toBe(false);
  });
});
