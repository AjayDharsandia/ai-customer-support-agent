import axios, { CanceledError } from 'axios';
import type { AxiosRequestConfig } from 'axios';
import { apiClient } from '../api/client';
import { env } from '../config/env';
import type { ApiSuccess, AuthData, AuthRequest, LogoutData } from '../types/api';

declare module 'axios' {
  interface AxiosRequestConfig {
    sessionGeneration?: number;
    skipAuth?: boolean;
    retriedAuth?: boolean;
    releaseSessionRequest?: () => void;
  }
}
export interface SessionState {
  session: AuthData | null;
  generation: number;
  status: 'checking' | 'authenticated' | 'unauthenticated';
  error: string;
}
export const initialSession: SessionState = { session: null, generation: 0, status: 'checking', error: '' };
let cookieQueue: Promise<unknown> = Promise.resolve();
async function decodeJsonErrorBody(error: unknown): Promise<void> {
  if (!axios.isAxiosError(error) || !error.response) return;
  const contentType = String(error.response.headers['content-type'] ?? '').toLowerCase();
  const body: unknown = error.response.data;
  if (!contentType.startsWith('application/json') || !body || typeof body !== 'object' ||
    !('getReader' in body) || typeof body.getReader !== 'function') return;
  const reader = (body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > 16 * 1024) throw new Error('API error response was too large.');
    }
    text += decoder.decode();
    error.response.data = JSON.parse(text) as unknown;
  } catch {
    // Leave the opaque body in place. It will be handled as an unknown failure.
  } finally {
    reader.releaseLock();
  }
}
function serializeCookie<T>(work: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    if (typeof navigator !== 'undefined' && navigator.locks) return await navigator.locks.request('csa-auth-cookie', work);
    return await work();
  };
  const result = cookieQueue.then(run, run);
  cookieQueue = result.catch(() => undefined);
  return result;
}
function sessionData(body: ApiSuccess<AuthData>): AuthData {
  const data = body.data;
  if (!body.success || !data?.user?.id || !data.user.email || !data.token ||
    !Number.isFinite(Date.parse(data.expiresAt)) || Date.parse(data.expiresAt) <= Date.now()) {
    throw new Error('Invalid authentication response.');
  }
  return data;
}
export function createSession(publish: (state: SessionState) => void) {
  let state = { ...initialSession };
  let active = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flight: Promise<void> | undefined;
  let loggedOut = false;
  let logoutUnconfirmed = false;
  let channel: BroadcastChannel | undefined;
  const pending = new Set<AbortController>();
  const emit = (change: Partial<SessionState>) => {
    state = { ...state, ...change };
    if (active) publish(state);
  };
  const clear = (status: SessionState['status'] = 'unauthenticated') => {
    clearTimeout(timer);
    for (const controller of pending) controller.abort();
    pending.clear();
    flight = undefined;
    emit({ session: null, generation: state.generation + 1, status, error: '' });
  };
  const ensureCurrent = (generation: number) => {
    if (!active || generation !== state.generation) throw new CanceledError('The session changed.');
  };
  const cookieCall = <T extends AuthData | LogoutData = AuthData>(action: string, body: AuthRequest | Record<string, never>) =>
    apiClient.post<ApiSuccess<T>>('/auth/' + action, body, {
      skipAuth: true, withCredentials: true, headers: { 'X-CSRF-Protection': '1' },
    });
  const install = (data: AuthData) => {
    if (state.session && state.session.user.id !== data.user.id) clear();
    emit({ session: data, status: 'authenticated', error: '' });
    clearTimeout(timer);
    timer = setTimeout(() => { void refresh().catch(() => undefined); },
      Math.max(0, Date.parse(data.expiresAt) - Date.now()));
  };
  const refresh = (): Promise<void> => {
    if (loggedOut || !active) return Promise.reject(new CanceledError('Signed out.'));
    if (flight) return flight;
    const generation = state.generation;
    const operation = serializeCookie(async () => {
      ensureCurrent(generation);
      const response = await cookieCall('refresh', {});
      ensureCurrent(generation);
      install(sessionData(response.data));
    }).catch((error: unknown) => {
      if (active && generation === state.generation && !axios.isCancel(error)) {
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          clear(); loggedOut = true;
        } else {
          emit({ error: 'Session restoration is temporarily unavailable. Retry to continue.' });
        }
      }
      throw error;
    });
    flight = operation;
    void operation.finally(() => { if (flight === operation) flight = undefined; }).catch(() => undefined);
    return operation;
  };
  const logout = () => {
    loggedOut = true;
    logoutUnconfirmed = true;
    clear();
    channel?.postMessage('logout');
    const generation = state.generation;
    void serializeCookie(async () => {
      // Wait for earlier Set-Cookie responses before revoking the browser's current credential.
      await cookieCall<LogoutData>('logout', {});
      if (active && generation === state.generation) {
        logoutUnconfirmed = false;
        emit({ error: '' });
      }
    }).catch(() => {
      if (active && generation === state.generation) {
        emit({ error: 'Signed out locally. Server logout could not be confirmed. Retry logout before closing this page; reloading may restore the session.' });
      }
    });
  };
  async function authenticate(action: 'login' | 'signup', input: AuthRequest) {
    const switchingAccount = Boolean(state.session);
    clear();
    loggedOut = true;
    const generation = state.generation;
    await serializeCookie(async () => {
      ensureCurrent(generation);
      // A deliberate account switch must revoke the previous browser session first.
      if (switchingAccount || logoutUnconfirmed) await cookieCall<LogoutData>('logout', {});
      const response = await cookieCall(action, input);
      ensureCurrent(generation);
      logoutUnconfirmed = false; loggedOut = false;
      install(sessionData(response.data));
      channel?.postMessage('changed');
    });
  }
  function start() {
    active = true;
    const requestId = apiClient.interceptors.request.use(async (config) => {
      const base = new URL(env.apiBaseUrl + '/', window.location.origin);
      const supplied = new URL((config.baseURL ?? env.apiBaseUrl) + '/', window.location.origin);
      if (supplied.href !== base.href || config.url?.startsWith('//')) throw new CanceledError('Untrusted API destination.');
      const target = new URL(config.url?.replace(/^\//, '') ?? '', base);
      // Axios absolute URLs must never escape the configured API boundary.
      if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname)) throw new CanceledError('Untrusted API destination.');
      if (config.skipAuth) {
        config.headers.delete('Authorization');
        return config;
      }
      const generation = config.sessionGeneration ?? state.generation;
      ensureCurrent(generation);
      if (state.session && Date.parse(state.session.expiresAt) <= Date.now()) await refresh();
      ensureCurrent(generation);
      config.sessionGeneration = generation;
      config.headers.delete('Authorization');
      if (state.session) config.headers.set('Authorization', 'Bearer ' + state.session.token);
      const controller = new AbortController();
      pending.add(controller);
      config.signal = config.signal instanceof AbortSignal ? AbortSignal.any([config.signal, controller.signal]) : controller.signal;
      config.releaseSessionRequest = () => { pending.delete(controller); };
      return config;
    });
    const responseId = apiClient.interceptors.response.use((response) => {
      response.config.releaseSessionRequest?.();
      if (!response.config.skipAuth) ensureCurrent(response.config.sessionGeneration!);
      return response;
    }, async (error: unknown) => {
      await decodeJsonErrorBody(error);
      if (!axios.isAxiosError(error) || !error.config || error.config.skipAuth) throw error;
      const config: AxiosRequestConfig = error.config;
      config.releaseSessionRequest?.();
      ensureCurrent(config.sessionGeneration!);
      const body = error.response?.data as { error?: { code?: string } } | undefined;
      // Only this backend's pre-handler authentication rejection permits a POST retry.
      if (error.response?.status === 401 && body?.error?.code === 'UNAUTHORIZED' && !config.retriedAuth) {
        config.retriedAuth = true;
        const sent = error.config.headers.get('Authorization');
        if (!state.session || sent === 'Bearer ' + state.session.token) await refresh();
        ensureCurrent(config.sessionGeneration!);
        return apiClient.request(config);
      }
      if (error.response?.status === 401) { clear(); loggedOut = true; }
      throw error;
    });
    const checkExpiry = () => {
      if (!loggedOut && state.session && Date.parse(state.session.expiresAt) <= Date.now()) void refresh().catch(() => undefined);
    };
    window.addEventListener('focus', checkExpiry);
    document.addEventListener('visibilitychange', checkExpiry);
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel('csa-auth');
      channel.onmessage = (event: MessageEvent<unknown>) => {
        if (event.data === 'logout') { loggedOut = true; clear(); }
        if (event.data === 'changed') { loggedOut = false; clear('checking'); void refresh().catch(() => undefined); }
      };
    }
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) void refresh().catch(() => undefined); });
    return () => {
      cancelled = true;
      active = false;
      clearTimeout(timer);
      state = { ...state, generation: state.generation + 1 };
      for (const controller of pending) controller.abort();
      pending.clear();
      apiClient.interceptors.request.eject(requestId);
      apiClient.interceptors.response.eject(responseId);
      window.removeEventListener('focus', checkExpiry);
      document.removeEventListener('visibilitychange', checkExpiry);
      channel?.close();
    };
  }
  return { start, logout, login: (input: AuthRequest) => authenticate('login', input),
    signup: (input: AuthRequest) => authenticate('signup', input),
    retry: () => { if (logoutUnconfirmed) logout(); else { loggedOut = false; void refresh().catch(() => undefined); } } };
}
