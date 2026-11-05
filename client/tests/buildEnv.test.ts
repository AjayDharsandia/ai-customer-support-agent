import { fileURLToPath } from 'node:url';
import { mkdtemp, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { build, resolveConfig } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
const metadata = [
  'VITE_VERCEL_ENV', 'VITE_VERCEL_TARGET_ENV', 'VITE_VERCEL_URL', 'VITE_VERCEL_BRANCH_URL',
  'VITE_VERCEL_PROJECT_PRODUCTION_URL', 'VITE_VERCEL_HASH_SALT', 'VITE_VERCEL_GIT_PROVIDER',
  'VITE_VERCEL_GIT_REPO_SLUG', 'VITE_VERCEL_GIT_REPO_OWNER', 'VITE_VERCEL_GIT_REPO_ID',
  'VITE_VERCEL_GIT_COMMIT_REF', 'VITE_VERCEL_GIT_COMMIT_SHA', 'VITE_VERCEL_GIT_COMMIT_MESSAGE',
  'VITE_VERCEL_GIT_COMMIT_AUTHOR_LOGIN', 'VITE_VERCEL_GIT_COMMIT_AUTHOR_NAME', 'VITE_VERCEL_GIT_PULL_REQUEST_ID',
  'VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG',
];
const settings = { root, configFile, logLevel: 'silent' as const };

beforeEach(() => {
  vi.stubEnv('VITE_API_BASE_URL', '/backend');
  for (const name of metadata) vi.stubEnv(name, 'synthetic-metadata-marker');
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('Vercel build environment boundary', () => {
  it.each(['build', 'serve'] as const)('accepts documented build metadata without automatic exposure (%s)', async (command) => {
    const config = await resolveConfig(settings, command, command === 'build' ? 'production' : 'development');
    expect(Object.keys(config.env).filter(name => name.startsWith('VITE_'))).toEqual([]);
    expect(config.define?.['import.meta.env.VITE_API_BASE_URL']).toBe(JSON.stringify('/backend'));
    expect(Object.keys(config.define ?? {}).some(name => name.includes('VITE_VERCEL_'))).toBe(false);
  });

  it.each([
    'VITE_UNEXPECTED', 'VITE_JWT_SECRET', 'VITE_MONGODB_URI', 'VITE_OPENROUTER_API_KEY', 'VITE_BACKEND_API_URL',
    'VITE_API_BASE_URL_SECRET', 'VITE_VERCEL_SECRET', 'VITE_VERCEL_JWT_SECRET', 'VITE_VERCEL_URL_EXTRA',
  ])('rejects unexpected names even alongside legitimate metadata: %s', async (name) => {
    vi.stubEnv(name, 'synthetic-private-marker');
    await expect(resolveConfig(settings, 'build', 'production')).rejects.toThrow(
      'Only VITE_API_BASE_URL may be exposed to the browser. Unexpected variable names: ' + name,
    );
  });

  it.each(['', 'https://user:password@example.com', 'http://remote.example.com'])(
    'still rejects missing or unsafe API configuration (case %#)', async (value) => {
      vi.stubEnv('VITE_API_BASE_URL', value);
      await expect(resolveConfig(settings, 'build', 'production')).rejects.toThrow('VITE_API_BASE_URL must be');
    },
  );

  it('keeps metadata and backend credentials out of actual bundled import.meta.env', async () => {
    for (const name of ['BACKEND_API_URL', 'JWT_SECRET', 'MONGODB_URI', 'OPENROUTER_API_KEY']) vi.stubEnv(name, 'synthetic-private-marker');
    const directory = await mkdtemp(join(tmpdir(), 'csa-env-probe-'));
    const entry = join(directory, 'probe.js');
    await writeFile(entry, `globalThis.probe = {
      env: import.meta.env,
      metadata: import.meta.env.VITE_VERCEL_URL,
      observability: import.meta.env.VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG,
      secret: import.meta.env.JWT_SECRET
    };`);
    try {
      const result = await build({
        ...settings,
        build: { write: false, minify: false, lib: { entry, formats: ['es'], fileName: 'env-boundary-probe' } },
      });
      const outputs = Array.isArray(result) ? result : [result];
      let checked = false;
      for (const output of outputs) {
        if (!('output' in output)) throw new Error('Expected a completed build');
        for (const chunk of output.output) {
          if (chunk.type !== 'chunk' || !chunk.isEntry) continue;
          expect(chunk.code.includes('synthetic-metadata-marker')).toBe(false);
          expect(chunk.code.includes('synthetic-private-marker')).toBe(false);
          const context: { probe?: { env: Record<string, unknown>; metadata?: unknown; observability?: unknown; secret?: unknown } } = {};
          runInNewContext(chunk.code, context);
          expect(context.probe?.env.VITE_API_BASE_URL).toBe('/backend');
          expect(Object.keys(context.probe?.env ?? {}).filter(name => name.startsWith('VITE_'))).toEqual(['VITE_API_BASE_URL']);
          expect(context.probe?.metadata).toBeUndefined();
          expect(context.probe?.observability).toBeUndefined();
          expect(context.probe?.secret).toBeUndefined();
          checked = true;
        }
      }
      expect(checked).toBe(true);
    } finally {
      await unlink(entry);
      await rmdir(directory);
    }
  });
});
