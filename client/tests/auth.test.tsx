// @vitest-environment jsdom
import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import axios, { AxiosHeaders } from 'axios';
import App from '../src/App';
import { AuthProvider } from '../src/auth/AuthProvider';
import { useAuth } from '../src/auth/AuthContext';
import { ProtectedRoute } from '../src/auth/ProtectedRoute';
import { apiClient } from '../src/api/client';
import { validateAuthForm } from '../src/auth/validation';

let adapter: MockAdapter;
const session = (email = 'a@example.test', seconds = 3600) => ({
  success: true,
  data: { user: { id: '507f1f77bcf86cd799439011', email },
    token: 'synthetic-test-token-' + email, expiresAt: new Date(Date.now() + seconds * 1000).toISOString() },
});
beforeEach(() => {
  adapter = new MockAdapter(apiClient);
  adapter.onPost('/auth/refresh').reply(401, {success:false,error:{code:'UNAUTHORIZED'}});
  adapter.onPost('/auth/logout').reply(200, {success:true,data:{loggedOut:true}});
  adapter.onGet('/chat/history').reply(200, { success: true, data: { conversations: [], pagination: { page: 1, limit: 20, total: 0, hasMore: false } } });
});
afterEach(() => { cleanup(); adapter.restore(); vi.useRealTimers(); vi.restoreAllMocks(); });
function mount(path = '/chat') {
  return render(<StrictMode><MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter></StrictMode>);
}
const authRequests = () => adapter.history.post.filter(r => r.url === '/auth/login' || r.url === '/auth/signup');
async function submit(mode: 'login' | 'signup' = 'login', email = 'a@example.test') {
  await screen.findByLabelText('Email address');
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Email address'), email);
  await user.type(screen.getByLabelText('Password'), 'password123');
  await user.click(screen.getByRole('button', { name: mode === 'login' ? 'Sign in' : 'Create account' }));
}
describe('UI-01 minimal real React forms and guards', () => {
  it('redirects unauthenticated chat, logs in, logs out and does not persist tokens', async () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    adapter.onPost('/auth/login').reply(200, session());
    mount();
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    await submit();
    expect(await screen.findByText('a@example.test')).toBeTruthy();
    const authRequest = authRequests()[0];
    expect(authRequest?.headers instanceof AxiosHeaders ? authRequest.headers.get('Authorization') : undefined).toBeUndefined();
    expect(JSON.parse(authRequest?.data as string)).toEqual({ email: 'a@example.test', password: 'password123' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(screen.queryByText('a@example.test')).toBeNull();
    expect(storage).not.toHaveBeenCalled();
  });
  it('requires login on remount when no valid refresh cookie exists', async () => {
    adapter.onPost('/auth/signup').reply(201, session());
    const view = mount('/signup');
    await submit('signup', 'A@Example.test');
    expect(await screen.findByText('a@example.test')).toBeTruthy();
    view.unmount();
    mount('/chat');
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
  });
  it('validates fields accessibly before any request', async () => {
    mount('/signup');
    await screen.findByLabelText('Email address');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(screen.getByLabelText('Email address').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Password').getAttribute('aria-invalid')).toBe('true');
    expect(authRequests()).toHaveLength(0);
    for (const password of ['1234567', 'a'.repeat(73), '\u{1F600}'.repeat(19)]) {
      expect(validateAuthForm({ email: 'a@example.test', password }).password).toBeDefined();
    }
    expect(validateAuthForm({ email: 'a@example.test', password: '\u{1F600}'.repeat(18) })).toEqual({});
  });
  it.each([401, 409, 503, 500])('shows safe API failure %s and re-enables the form', async (status) => {
    adapter.onPost('/auth/login').reply(status, { error: { message: 'private-server-marker' } });
    mount('/login');
    await submit();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('private-server-marker')).toBeNull();
    expect((screen.getByRole('button', { name: 'Sign in' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('prevents duplicate submissions and ignores a response after leaving the form', async () => {
    let finish: (value: [number, unknown]) => void = () => undefined;
    adapter.onPost('/auth/login').reply(() => new Promise<[number, unknown]>((resolve) => { finish = resolve; }));
    const view = mount('/login');
    await submit();
    expect((screen.getByRole('button', { name: 'Please wait...' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByLabelText('Password').closest('form')!);
    expect(authRequests()).toHaveLength(1);
    view.unmount();
    await act(async () => { finish([200, session()]); });
    mount();
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
  });
});

function Harness() {
  const { user, login, logout } = useAuth();
  return <div>
    <p data-testid="identity">{user?.email ?? 'signed out'}</p>
    <button onClick={() => { void login({ email: 'a@example.test', password: 'password123' }).catch(() => undefined); }}>Account A</button>
    <button onClick={() => { void login({ email: 'b@example.test', password: 'password123' }).catch(() => undefined); }}>Account B</button>
    <button onClick={logout}>Logout</button>
    <Routes><Route path="/login" element={user ? <Navigate to="/chat" replace /> : <p>Login required</p>} />
      <Route element={<ProtectedRoute />}><Route path="/chat" element={<PrivateState />} /></Route></Routes>
  </div>;
}
function PrivateState() {
  const [draft, setDraft] = useState('');
  return <input aria-label="Private draft fixture" value={draft} onChange={(event) => setDraft(event.target.value)} />;
}
function mountHarness() {
  return render(<MemoryRouter initialEntries={['/chat']}><AuthProvider><Harness /></AuthProvider></MemoryRouter>);
}
async function signIn(account: 'A' | 'B' = 'A') {
  fireEvent.click(screen.getByText('Account ' + account));
  await waitFor(() => expect(screen.getByTestId('identity').textContent).toBe(account.toLowerCase() + '@example.test'));
}
describe('UI-06 in-memory request lifecycle', () => {
  beforeEach(() => {
    adapter.onPost('/auth/login').reply((config) => [200, session((JSON.parse(config.data as string) as { email: string }).email)]);
  });
  it('attaches Bearer only to the configured backend and rejects other origins', async () => {
    mountHarness();
    await signIn();
    adapter.onGet('/probe').reply(200, { success: true });
    await apiClient.get('/probe');
    expect(adapter.history.get[0]?.headers instanceof AxiosHeaders ? adapter.history.get[0].headers.get('Authorization') : undefined).toBe('Bearer synthetic-test-token-a@example.test');
    await expect(apiClient.get('https://untrusted.example/probe')).rejects.toSatisfy(axios.isCancel);
    expect(adapter.history.get).toHaveLength(1);
  });
  it('remounts private state on account changes and removes it on logout', async () => {
    mountHarness();
    await signIn();
    fireEvent.change(await screen.findByLabelText('Private draft fixture'), { target: { value: 'A private draft' } });
    await signIn('B');
    expect((await screen.findByLabelText('Private draft fixture') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByText('Logout'));
    expect(screen.queryByLabelText('Private draft fixture')).toBeNull();
  });
  it('clears the session on 401', async () => {
    mountHarness();
    await signIn();
    adapter.onGet('/probe').reply(401);
    await act(async () => { await apiClient.get('/probe').catch(() => undefined); });
    expect(screen.getByTestId('identity').textContent).toBe('signed out');
  });
  it('expires the session using its timer and clears state on focus after suspension', async () => {
    adapter.onPost('/auth/login').reply(200, session('a@example.test', 5));
    mountHarness();
    await signIn();
    const future = Date.now() + 6000;
    vi.spyOn(Date, 'now').mockReturnValue(future);
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByTestId('identity').textContent).toBe('signed out'));
    vi.restoreAllMocks();
    vi.useFakeTimers();
    fireEvent.click(screen.getByText('Account A'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.getByTestId('identity').textContent).toBe('a@example.test');
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(screen.getByTestId('identity').textContent).toBe('signed out');
  });
  it.each([200, 401])('discards delayed account A response %s without affecting B', async (status) => {
    mountHarness();
    await signIn();
    let finish: (value: [number, unknown]) => void = () => undefined;
    adapter.onGet('/probe').reply(() => new Promise<[number, unknown]>((resolve) => { finish = resolve; }));
    const outcome = apiClient.get('/probe').then(() => 'accepted', (error: unknown) => axios.isCancel(error) ? 'cancelled' : 'failed');
    await waitFor(() => expect(adapter.history.get).toHaveLength(1));
    fireEvent.click(screen.getByText('Logout'));
    await signIn('B');
    await act(async () => { finish([status, { private: 'Account A data' }]); });
    expect(await outcome).toBe('cancelled');
    expect(screen.getByTestId('identity').textContent).toBe('b@example.test');
    expect(screen.queryByText('Account A data')).toBeNull();
  });
  it('cannot restore a session from a stale login after logout', async () => {
    let finish: (value: [number, unknown]) => void = () => undefined;
    adapter.onPost('/auth/login').reply(() => new Promise<[number, unknown]>((resolve) => { finish = resolve; }));
    mountHarness();
    fireEvent.click(screen.getByText('Account A'));
    await waitFor(() => expect(authRequests()).toHaveLength(1));
    fireEvent.click(screen.getByText('Logout'));
    await act(async () => { finish([200, session()]); });
    expect(screen.getByTestId('identity').textContent).toBe('signed out');
  });
});
