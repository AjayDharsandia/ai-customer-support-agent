// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { AxiosHeaders } from 'axios';
import type { AxiosRequestConfig } from 'axios';
import App from '../src/App';
import { AuthProvider } from '../src/auth/AuthProvider';
import { apiClient } from '../src/api/client';

const denied = { success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication is required.' } };
const identity = (token = 'access-original', email = 'restore@example.test') => ({ success: true, data: {
  user: { id: '507f1f77bcf86cd799439011', email }, token, expiresAt: new Date(Date.now() + 3600000).toISOString(),
} });
const history = { success: true, data: { conversations: [], pagination: { page: 1, limit: 20, total: 0, hasMore: false } } };
let mock: MockAdapter;
beforeEach(() => {
  mock = new MockAdapter(apiClient, { onNoMatch: 'throwException' });
  mock.onPost('/auth/refresh').reply(() => [200, identity()]);
  mock.onPost('/auth/logout').reply(200, { success: true, data: { loggedOut: true } });
  mock.onGet('/chat/history').reply(200, history);
});
afterEach(() => { cleanup(); mock.restore(); vi.restoreAllMocks(); });
function mount(path = '/chat') { return render(<StrictMode><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></StrictMode>); }
const refreshes = () => mock.history.post.filter(r => r.url === '/auth/refresh');
function headers(config: AxiosRequestConfig) {
  if (!(config.headers instanceof AxiosHeaders)) throw new Error('Expected normalized Axios headers');
  return config.headers;
}
function delayed() {
  let resolve: (response: [number, unknown]) => void = () => undefined;
  const promise = new Promise<[number, unknown]>(r => { resolve = r; });
  return { promise, resolve };
}
describe('AUTH-P frontend persistence and coordinated refresh', () => {
  it('waits before routing, restores identity/history and runs one refresh under StrictMode', async () => {
    const pending = delayed();
    mock.onPost('/auth/refresh').reply(() => pending.promise);
    mount();
    expect(screen.getByRole('status').textContent).toContain('Restoring');
    expect(screen.queryByLabelText('Email address')).toBeNull();
    await waitFor(() => expect(refreshes()).toHaveLength(1));
    await act(async () => pending.resolve([200, identity()]));
    await screen.findByText('restore@example.test');
    await screen.findByText(/No saved conversations yet/);
    expect(mock.history.get).toHaveLength(1);
    expect(refreshes()[0]!.withCredentials).toBe(true);
    expect(headers(refreshes()[0]!).get('X-CSRF-Protection')).toBe('1');
    expect(headers(refreshes()[0]!).has('Authorization')).toBe(false);
  });
  it('restores the session after a full React remount without any persistent JS storage', async () => {
    const view = mount(); await screen.findByText('restore@example.test');
    view.unmount(); mount('/chat');
    await screen.findByText('restore@example.test');
    expect(refreshes()).toHaveLength(2);
    expect(localStorage.length + sessionStorage.length).toBe(0);
  });
  it.each([401, 503])('distinguishes credential failure from temporary outage (%s)', async (status) => {
    mock.onPost('/auth/refresh').reply(status, denied);
    mount();
    if (status === 401) await screen.findByLabelText('Email address');
    else {
      await screen.findByText(/Session restoration is temporarily unavailable/);
      expect(screen.queryByLabelText('Email address')).toBeNull();
      mock.onPost('/auth/refresh').reply(200, identity());
      fireEvent.click(screen.getByRole('button', { name: 'Retry session action' }));
      await screen.findByText('restore@example.test');
    }
  });
  it('coordinates concurrent authentication rejections and retries each request once with the new access token', async () => {
    mount(); await screen.findByText('restore@example.test');
    const pending = delayed();
    mock.onPost('/auth/refresh').reply(() => pending.promise);
    mock.onGet('/probe').reply(config => headers(config).get('Authorization') === 'Bearer access-new'
      ? [200, { success: true }] : [401, denied]);
    const requests = Array.from({ length: 4 }, () => apiClient.get('/probe'));
    await waitFor(() => expect(refreshes()).toHaveLength(2));
    await act(async () => { pending.resolve([200, identity('access-new')]); await Promise.all(requests); });
    expect(refreshes()).toHaveLength(2);
    expect(mock.history.get.filter(r => r.url === '/probe')).toHaveLength(8);
    expect(mock.history.get.filter(r => r.url === '/probe').slice(-4).every(r =>
      headers(r).get('Authorization') === 'Bearer access-new')).toBe(true);
  });
  it('does not loop when the once-retried request is still unauthorized', async () => {
    mount(); await screen.findByText('restore@example.test');
    mock.onPost('/auth/refresh').reply(200, identity('access-new'));
    mock.onGet('/probe').reply(401, denied);
    await act(async () => { await apiClient.get('/probe').catch(() => undefined); });
    await screen.findByLabelText('Email address');
    expect(mock.history.get.filter(r => r.url === '/probe')).toHaveLength(2);
    expect(refreshes()).toHaveLength(2);
  });
  it('clears private state immediately and queues logout behind an in-flight refresh response', async () => {
    mount(); await screen.findByText('restore@example.test');
    const pending = delayed();
    mock.onPost('/auth/refresh').reply(() => pending.promise);
    mock.onGet('/probe').reply(401, denied);
    const result = apiClient.get('/probe').catch(() => undefined);
    await waitFor(() => expect(refreshes()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByLabelText('Email address');
    expect(mock.history.post.filter(r => r.url === '/auth/logout')).toHaveLength(0);
    await act(async () => { pending.resolve([200, identity('late-access')]); await result; });
    await waitFor(() => expect(mock.history.post.filter(r => r.url === '/auth/logout')).toHaveLength(1));
    expect(screen.queryByText('restore@example.test')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Your message' })).toBeNull();
  });
  it('reports an unconfirmed server logout and provides an explicit retry', async () => {
    mock.onPost('/auth/logout').networkError();
    mount(); await screen.findByText('restore@example.test');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByText(/Server logout could not be confirmed/);
    expect(screen.queryByText('restore@example.test')).toBeNull();
    mock.onPost('/auth/logout').reply(200, { success: true, data: { loggedOut: true } });
    fireEvent.click(screen.getByRole('button', { name: 'Retry session action' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
  it('only retries chat after a pre-handler UNAUTHORIZED response, never after uncertain network failure', async () => {
    mount(); await screen.findByText('restore@example.test');
    mock.onPost('/auth/refresh').reply(200, identity('access-new'));
    mock.onPost('/chat/send').replyOnce(401, denied).onPost('/chat/send').reply(200, { success: true });
    await act(async () => { await apiClient.post('/chat/send', { message: 'Synthetic' }); });
    expect(mock.history.post.filter(r => r.url === '/chat/send')).toHaveLength(2);
    mock.onPost('/chat/send').networkError();
    await act(async () => { await apiClient.post('/chat/send', { message: 'Uncertain' }).catch(() => undefined); });
    expect(mock.history.post.filter(r => r.url === '/chat/send')).toHaveLength(3);
    expect(refreshes()).toHaveLength(2);
  });
  it('rejects malicious baseURL overrides and protocol-relative credential destinations', async () => {
    mount(); await screen.findByText('restore@example.test');
    await expect(apiClient.get('/probe', { baseURL: 'https://evil.example' })).rejects.toThrow('Untrusted');
    await expect(apiClient.get('//evil.example/probe')).rejects.toThrow('Untrusted');
    expect(mock.history.get.filter(r => r.url?.includes('probe'))).toHaveLength(0);
  });
  it('refreshes on resume after expiry and preserves chat state across same-user token renewal', async () => {
    const now = Date.now();
    mount(); await screen.findByText('restore@example.test');
    const composer = await screen.findByRole('textbox', { name: 'Your message' });
    fireEvent.change(composer, { target: { value: 'My unsent draft' } });
    mock.onPost('/auth/refresh').reply(() => [200, identity('renewed')]);
    vi.spyOn(Date, 'now').mockReturnValue(now + 3601000);
    fireEvent.focus(window);
    await waitFor(() => expect(refreshes()).toHaveLength(2));
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value).toBe('My unsent draft');
    expect(screen.getByText('restore@example.test')).toBeTruthy();
  });
  it('does not confuse provider authentication failure with user session expiry', async () => {
    mount(); await screen.findByText('restore@example.test');
    mock.onPost('/chat/send').reply(502, { success: false, error: { code: 'AI_REQUEST_FAILED' } });
    await act(async () => { await apiClient.post('/chat/send', { message: 'Synthetic' }).catch(() => undefined); });
    expect(refreshes()).toHaveLength(1);
    expect(mock.history.post.filter(r => r.url === '/chat/send')).toHaveLength(1);
    expect(screen.getByText('restore@example.test')).toBeTruthy();
  });
});
