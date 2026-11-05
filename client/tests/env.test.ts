import { describe, expect, it } from 'vitest';
import { validateClientEnv } from '../src/config/validateEnv';

describe('public frontend configuration', () => {
  it.each(['/backend', 'http://localhost:5000', 'http://127.0.0.1:5000', 'http://[::1]:5000', 'https://api.example.com'])(
    'accepts the permitted origin %s',
    (origin) => expect(validateClientEnv({ VITE_API_BASE_URL: origin }, true)).toEqual({ apiBaseUrl: origin }),
  );

  it.each([
    undefined, '', '/api', 'https://*.example.com', 'ftp://api.example.com', 'https://api.example.com/',
    'https://api.example.com/api', 'https://api.example.com?token=hidden',
    'https://api.example.com#hidden', 'https://user:password@api.example.com',
    ' https://api.example.com', 'http://api.example.com',
  ])('rejects invalid or insecure deployed origins without echoing them (%s)', (value) => {
    expect(() => validateClientEnv({ VITE_API_BASE_URL: value }, true)).toThrow('VITE_API_BASE_URL');
    if (value) {
      try { validateClientEnv({ VITE_API_BASE_URL: value }, true); }
      catch (error: unknown) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain(value);
      }
    }
  });

  it('allows remote HTTP only outside production', () => {
    expect(validateClientEnv({ VITE_API_BASE_URL: 'http://dev.example.com' }, false).apiBaseUrl)
      .toBe('http://dev.example.com');
  });

  it('rejects other VITE variables instead of embedding possible secrets', () => {
    expect(() => validateClientEnv({
      VITE_API_BASE_URL: 'http://localhost:5000',
      VITE_OPENROUTER_API_KEY: 'synthetic-marker',
    }, false)).toThrow('Only VITE_API_BASE_URL');
  });

  it('reports unexpected names without their values and still rejects metadata in browser configuration', () => {
    const names = ['VITE_JWT_SECRET', 'VITE_VERCEL_ENV', 'VITE_OPENROUTER_API_KEY'];
    try {
      validateClientEnv({ VITE_API_BASE_URL: '/backend', ...Object.fromEntries(names.map(name => [name, 'private-marker'])) }, true);
      expect.fail('Expected strict browser validation to reject extra names');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Only VITE_API_BASE_URL may be exposed to the browser. Unexpected variable names: ' + names.sort().join(', '));
    }
  });
});
