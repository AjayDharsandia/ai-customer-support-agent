import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

async function loadConfig(origin?: string) {
  vi.resetModules();
  vi.stubEnv('BACKEND_API_URL', origin);
  return (await import('../vercel')).config;
}

describe('Vercel deployment configuration', () => {
  it.each(['development', 'preview', 'production'])('uses the selected %s environment at evaluation time', async (target) => {
    vi.stubEnv('VERCEL_ENV', target);
    const origin = `https://${target}.example.com`;
    const config = await loadConfig(origin + '/');
    // Check serialized output, not just TypeScript types; Vercel validates this shape.
    expect(JSON.parse(JSON.stringify(config))).toEqual({ rewrites: [
      { source: '/backend/:path*', destination: `${origin}/:path*` },
      { source: '/(.*)', destination: '/index.html' },
    ] });
  });

  it('re-evaluates a changed backend origin without a source change', async () => {
    const first = await loadConfig('https://first.example.com');
    const second = await loadConfig('https://second.example.com');
    expect(first.rewrites?.[0]?.destination).not.toBe(second.rewrites?.[0]?.destination);
  });

  it.each(['https://example.com', ' https://example.com/ ', 'https://example.com///', 'https://example.com:443/'])(
    'normalizes trailing root slashes without retaining them (case %#)', async (value) => {
      const config = await loadConfig(value);
      expect(config.rewrites?.[0]?.destination).toBe('https://example.com/:path*');
    },
  );

  it.each([undefined, '', '   '])('rejects missing configuration (case %#)', async (value) => {
    await expect(loadConfig(value)).rejects.toThrow('BACKEND_API_URL is required');
  });

  it.each([
    'not-a-url', 'http://example.com', 'ftp://example.com', '//example.com',
    'https://user:private@example.com', 'https://@example.com', 'https://example.com/api',
    'https://example.com/api/..', 'https://example.com/%2e', 'https://example.com?private=value',
    'https://example.com#private', 'https://example.com?', 'https://example.com#',
    'https://example.com\\api', 'https://example.com\n.evil', 'https://example.com:99999',
    'https://*.example.com', 'https://$BACKEND_API_URL',
  ])('rejects unsafe configuration without reporting its value (case %#)', async (value) => {
    await expect(loadConfig(value)).rejects.toThrow(
      /^BACKEND_API_URL must be an HTTPS origin without credentials, path, query or fragment\.$/,
    );
  });
});
