import { routes, type VercelConfig } from '@vercel/config/v1';

const backendUrl = process.env.BACKEND_API_URL?.trim();

if (!backendUrl) throw new Error('BACKEND_API_URL is required in the selected Vercel environment.');

function parseBackendOrigin(value: string): string {
  const invalid = () => new Error('BACKEND_API_URL must be an HTTPS origin without credentials, path, query or fragment.');
  // Validate before URL normalization can hide dot segments, backslashes or credentials.
  // Also exclude SDK routing placeholders ($NAME) and wildcard hostnames.
  if (!/^https:\/\/[^\s\\/?#@$*]+\/*$/i.test(value)) throw invalid();
  let url: URL;
  try { url = new URL(value); } catch { throw invalid(); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname ||
      url.hostname.includes('%') || !/^\/*$/.test(url.pathname) || url.search || url.hash) throw invalid();
  return url.origin;
}

// Evaluated by Vercel at configuration/build time, never imported by the browser.
const backendOrigin = parseBackendOrigin(backendUrl);

export const config: VercelConfig = {
  rewrites: [
    routes.rewrite('/backend/:path*', `${backendOrigin}/:path*`),
    routes.rewrite('/(.*)', '/index.html'),
  ],
};
