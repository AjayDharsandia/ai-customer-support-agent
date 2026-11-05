export interface AuthConfig {
  accessSeconds: number;
  refreshSeconds: number;
  cookieMode: 'secure' | 'localhost';
}
const units: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
export function duration(value: string, name: string, maximum: number): number {
  const match = /^([1-9][0-9]*)(s|m|h|d)$/.exec(value);
  const seconds = match ? Number(match[1]) * (units[match[2]!] ?? 0) : 0;
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > maximum) {
    throw new Error(name + ' must be a positive duration using s, m, h or d within its documented maximum');
  }
  return seconds;
}
export function parseAuthConfig(values: Record<string, string | undefined>, origins: string[]): AuthConfig {
  const accessSeconds = duration(values.JWT_ACCESS_EXPIRES_IN ?? '15m', 'JWT_ACCESS_EXPIRES_IN', 3600);
  const refreshSeconds = duration(values.JWT_REFRESH_EXPIRES_IN ?? '1d', 'JWT_REFRESH_EXPIRES_IN', 30 * 86400);
  const cookieMode = values.AUTH_COOKIE_MODE ?? 'secure';
  if (refreshSeconds < accessSeconds) throw new Error('JWT_REFRESH_EXPIRES_IN must be at least JWT_ACCESS_EXPIRES_IN');
  if (cookieMode !== 'secure' && cookieMode !== 'localhost') throw new Error('AUTH_COOKIE_MODE must be secure or localhost');
  if (cookieMode === 'localhost' && (!origins.length || origins.some((origin) => {
    try { return !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname); } catch { return true; }
  }))) throw new Error('AUTH_COOKIE_MODE localhost requires only explicit loopback CLIENT_ORIGINS');
  return { accessSeconds, refreshSeconds, cookieMode };
}
