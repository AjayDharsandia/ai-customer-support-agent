import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { validateClientEnv } from './src/config/validateEnv.ts';

// Build-only framework metadata, not approved application configuration.
// Exact names from https://vercel.com/docs/environment-variables/framework-environment-variables
// Do not allow the entire VITE_VERCEL_ namespace: unknown keys may contain secrets.
const VERCEL_METADATA = new Set([
  'VITE_VERCEL_ENV',
  'VITE_VERCEL_TARGET_ENV',
  'VITE_VERCEL_URL',
  'VITE_VERCEL_BRANCH_URL',
  'VITE_VERCEL_PROJECT_PRODUCTION_URL',
  'VITE_VERCEL_HASH_SALT',
  'VITE_VERCEL_GIT_PROVIDER',
  'VITE_VERCEL_GIT_REPO_SLUG',
  'VITE_VERCEL_GIT_REPO_OWNER',
  'VITE_VERCEL_GIT_REPO_ID',
  'VITE_VERCEL_GIT_COMMIT_REF',
  'VITE_VERCEL_GIT_COMMIT_SHA',
  'VITE_VERCEL_GIT_COMMIT_MESSAGE',
  'VITE_VERCEL_GIT_COMMIT_AUTHOR_LOGIN',
  'VITE_VERCEL_GIT_COMMIT_AUTHOR_NAME',
  'VITE_VERCEL_GIT_PULL_REQUEST_ID',
  'VITE_VERCEL_OBSERVABILITY_CLIENT_CONFIG',
]);

export default defineConfig(({ mode }) => {
  const loaded = loadEnv(mode, process.cwd(), 'VITE_');
  const applicationEnv = Object.fromEntries(Object.entries(loaded).filter(([name]) => !VERCEL_METADATA.has(name)));
  const { apiBaseUrl } = validateClientEnv(applicationEnv, mode === 'production');

  return {
    // Disable prefix-based injection entirely; publish only the validated exact key.
    envPrefix: [],
    define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(apiBaseUrl) },
    plugins: [react(), tailwindcss()],
    server: { port: 5173, strictPort: true, proxy: { '/backend': { target: 'http://localhost:5000', rewrite: (path) => path.replace(/^\/backend/, '') } } },
  };
});
