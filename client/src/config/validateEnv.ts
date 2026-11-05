export interface ClientConfig {
  apiBaseUrl: string;
}

export function validateClientEnv(
  values: Record<string, unknown>,
  production: boolean,
): ClientConfig {
  const unexpected = Object.keys(values).filter((key) => key.startsWith('VITE_') && key !== 'VITE_API_BASE_URL').sort();
  if (unexpected.length) {
    // Diagnose configuration names without ever including their values.
    throw new Error('Only VITE_API_BASE_URL may be exposed to the browser. Unexpected variable names: ' + unexpected.join(', '));
  }

  const value = values.VITE_API_BASE_URL;
  const invalid = () => new Error('VITE_API_BASE_URL must be /backend or an HTTP(S) origin without credentials, a path, query, fragment, or trailing slash. Deployed origins require HTTPS.');

  if (typeof value !== 'string' || value.length === 0) {
    throw invalid();
  }

  if (value === '/backend') return { apiBaseUrl: value };

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }

  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.hostname.includes('*') ||
    url.origin !== value ||
    url.username !== '' ||
    url.password !== '' ||
    (production && !local && url.protocol !== 'https:')
  ) {
    throw invalid();
  }

  return { apiBaseUrl: value };
}
