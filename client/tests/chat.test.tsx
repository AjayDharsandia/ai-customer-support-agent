// @vitest-environment jsdom
import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import axios, { AxiosHeaders } from 'axios';
import App from '../src/App';
import { AuthProvider } from '../src/auth/AuthProvider';
import { apiClient } from '../src/api/client';
import type { ChatMessage, ConversationDetail, ConversationSummary, SendChatData } from '../src/types/api';
import { validateMessage } from '../src/chat/errors';

const firstId = '507f1f77bcf86cd799439011';
const secondId = '507f1f77bcf86cd799439012';
const date = '2026-11-04T10:00:00.000Z';
const success = <T,>(data: T) => ({ success: true, data });
const failure = (code: string) => ({ success: false, error: { code, message: 'private-error-marker' } });
function pair(text = 'Saved question', reply = 'Saved answer', offset = 0): ChatMessage[] {
  return [{ id: String(offset + 1).padStart(24, '0'), role: 'user', content: text, createdAt: date },
    { id: String(offset + 2).padStart(24, '0'), role: 'assistant', content: reply, createdAt: date }];
}
const first: ConversationDetail = { id: firstId, title: 'Account support', createdAt: date, updatedAt: date, messages: pair() };
const second: ConversationDetail = { id: secondId, title: 'Billing question', createdAt: date, updatedAt: date, messages: pair('Billing question text', 'Billing answer') };
function list(items: ConversationSummary[] = [], page = 1, hasMore = false, total = items.length) {
  return success({ conversations: items.map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt })),
    pagination: { page, limit: 5, total, hasMore } });
}
function saved(text = 'New question', reply = 'New answer', id = firstId, offset = 10): SendChatData {
  const messages = pair(text, reply, offset);
  return { conversationId: id, title: 'Account support', userMessage: messages[0]!, assistantMessage: messages[1]!, updatedAt: date };
}
function deferred() {
  let resolve: (value: [number, unknown]) => void = () => undefined;
  const promise = new Promise<[number, unknown]>((finish) => { resolve = finish; });
  return { promise, resolve };
}
let mock: MockAdapter;
const sendClient = axios.create();
let sendMock: MockAdapter;
function streamResponse(value: unknown, requestedConversationId: string | null): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const body = value as { success?: boolean; data?: SendChatData };
  const conversationId = requestedConversationId;
  const frames = body.success && body.data ? [
    `event: started\ndata: ${JSON.stringify({ conversationId })}\n\n`,
    `event: delta\ndata: ${JSON.stringify({ text: body.data.assistantMessage.content })}\n\n`,
    `event: committed\ndata: ${JSON.stringify(body.data)}\n\n`,
  ] : [
    `event: started\ndata: ${JSON.stringify({ conversationId })}\n\n`,
    `event: committed\ndata: ${JSON.stringify(body.data ?? {})}\n\n`,
  ];
  return new ReadableStream({ start(controller) { frames.forEach((frame) => controller.enqueue(encoder.encode(frame))); controller.close(); } });
}
beforeEach(() => {
  mock = new MockAdapter(apiClient, { onNoMatch: 'throwException' });
  sendMock = new MockAdapter(sendClient, { onNoMatch: 'throwException' });
  mock.onPost('/auth/refresh').reply(401, {success:false,error:{code:'UNAUTHORIZED'}});
  mock.onPost('/auth/logout').reply(200, {success:true,data:{loggedOut:true}});
  mock.onPost('/auth/login').reply((config) => {
    const { email } = JSON.parse(config.data as string) as { email: string };
    return [200, success({ user: { id: email.startsWith('b') ? secondId : firstId, email },
      token: 'synthetic-' + email, expiresAt: new Date(Date.now() + 3600000).toISOString() })];
  });
  mock.onGet('/chat/history').reply(200, list());
  // Axios uses its fetch adapter for response streaming. This bridge retains
  // the existing concise fixtures while exercising the real SSE parser.
  vi.stubGlobal('fetch', async (resource: RequestInfo | URL, init?: RequestInit) => {
    const request = resource instanceof Request ? resource : new Request(resource, init);
    if (!request.url.endsWith('/chat/send/stream')) throw new Error('Unexpected fetch request: ' + new URL(request.url).pathname);
    const input = JSON.parse(await request.clone().text()) as { conversationId?: string; message: string };
    try {
      const response = await sendClient.post('/chat/send', input, {
        signal: request.signal, headers: { Authorization: request.headers.get('Authorization') ?? '' },
      });
      return new Response(streamResponse(response.data, input.conversationId ?? null), {
        status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' },
      });
    } catch (error: unknown) {
      if (axios.isAxiosError(error) && error.response) return new Response(JSON.stringify(error.response.data), {
        status: error.response.status, headers: { 'content-type': 'application/json' },
      });
      throw error;
    }
  });
});
afterEach(() => { cleanup(); mock.restore(); sendMock.restore(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function mount() {
  return render(<StrictMode><MemoryRouter initialEntries={['/chat']}><AuthProvider><App /></AuthProvider></MemoryRouter></StrictMode>);
}
async function login(email = 'a@example.test') {
  await screen.findByLabelText('Email address');
  fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('heading', { name: 'New conversation' });
  await waitFor(() => expect(mock.history.get.length).toBeGreaterThan(0));
}
function draft(value = 'New question') { fireEvent.change(screen.getByRole('textbox', { name: 'Your message' }), { target: { value } }); }
function send() { fireEvent.submit(screen.getByRole('form', { name: 'Send a support message' })); }
function sends() { return sendMock.history.post.filter((request) => request.url === '/chat/send'); }
function useHistory() {
  mock.onGet('/chat/history').reply((config) => {
    const id: unknown = config.params?.conversationId;
    return [200, id ? success(id === firstId ? first : second) : list([first, second])];
  });
}
async function select(title = 'Account support') {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(title) }));
  await screen.findByRole('heading', { name: title });
}

describe('UI-01/02/03 complete chat flow', () => {
  it('renders fragmented UTF-8 deltas progressively and confirms them only after committed', async () => {
    mount(); await login();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream<Uint8Array>({
      start(value) { controller = value; },
    }), { status: 200, headers: { 'content-type': 'text/event-stream; charset=utf-8' } }));
    draft('Stream question'); send();
    await screen.findByRole('status', { name: 'Assistant is typing' });
    const encoder = new TextEncoder();
    await act(async () => {
      controller?.enqueue(encoder.encode('event: started\ndata: {"conversationId":null}\n\n'));
      const delta = encoder.encode('event: delta\ndata: {"text":"Hello 😀"}\n\n');
      const split = delta.indexOf(0xf0) + 2;
      controller?.enqueue(delta.slice(0, split));
      controller?.enqueue(delta.slice(split));
    });
    const temporary = await screen.findByRole('article', { name: 'Assistant message (streaming)' });
    expect(temporary.textContent).toContain('Hello 😀');
    expect(temporary.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByRole('article', { name: 'Assistant message' })).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value).toBe('Stream question');
    await act(async () => {
      controller?.enqueue(encoder.encode(`event: committed\ndata: ${JSON.stringify(saved('Stream question', 'Hello 😀'))}\n\n`));
      controller?.close();
    });
    expect((await screen.findByRole('article', { name: 'Assistant message' })).textContent).toContain('Hello 😀');
    expect(screen.queryByRole('article', { name: 'Assistant message (streaming)' })).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value).toBe('');
  });
  it('loads history once in StrictMode, keeps empty new chat unsaved and sends exact Bearer contracts', async () => {
    sendMock.onPost('/chat/send').reply(200, success(saved()));
    mount(); await login();
    expect(await screen.findByText(/No saved conversations yet/)).toBeTruthy();
    expect(mock.history.get).toHaveLength(1);
    expect(mock.history.post.filter(r => r.url !== '/auth/refresh')).toHaveLength(1);
    draft('  New question  '); send();
    expect(await screen.findByText('New answer')).toBeTruthy();
    expect(screen.getByRole('article', { name: 'Your message' }).textContent).toContain('New question');
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value).toBe('');
    expect(JSON.parse(sends()[0]?.data as string)).toEqual({ message: 'New question' });
    const headers = sends()[0]?.headers;
    expect(headers instanceof AxiosHeaders && headers.get('Authorization')).toBe('Bearer synthetic-a@example.test');
    await waitFor(() => expect(mock.history.get).toHaveLength(2));
  });
  it('displays only acknowledged pairs, blocks repeat submits and switching, and keeps logout available', async () => {
    useHistory();
    const pending = deferred();
    sendMock.onPost('/chat/send').reply(() => pending.promise);
    mount(); await login(); await screen.findByRole('button', { name: /Account support/ });
    draft(); send(); send();
    await screen.findByRole('status', { name: 'Assistant is typing' });
    expect(sends()).toHaveLength(1);
    expect(screen.getByRole('article', { name: 'Your message (saving)' })).toBeTruthy();
    for (const name of ['New chat', /Account support/, /Billing question/]) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect((screen.getByRole('button', { name: 'Sign out' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => pending.resolve([200, success(saved())]));
    expect(await screen.findByText('New answer')).toBeTruthy();
    expect(sends()).toHaveLength(1);
  });
  it('opens and continues transcripts in order and retains drafts per conversation', async () => {
    useHistory();
    sendMock.onPost('/chat/send').reply(200, success(saved('Continue', 'Continued answer', firstId, 20)));
    mount(); await login();
    draft('Unsent new draft'); await select();
    expect(await screen.findByText('Saved answer')).toBeTruthy();
    draft('Continue'); await select('Billing question');
    draft('Billing draft'); await select();
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value).toBe('Continue');
    send();
    await screen.findByText('Continued answer');
    expect(JSON.parse(sends()[0]?.data as string)).toEqual({ message: 'Continue', conversationId: firstId });
    expect(within(screen.getByRole('list', { name: 'Conversation messages' })).getAllByRole('article').map((item) => item.querySelector('p')?.textContent))
      .toEqual(['Saved question', 'Saved answer', 'Continue', 'Continued answer']);
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value).toBe('Unsent new draft');
    expect(screen.queryByText('Continued answer')).toBeNull();
  });
  it('paginates summaries without duplicate reads and handles an empty page', async () => {
    mock.onGet('/chat/history').reply((config) => config.params?.page === 1 ? [200, list([first], 1, true, 21)] : [200, list([], 2, false, 20)]);
    mount(); await login();
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await screen.findByText('Page 2');
    expect(screen.getByText(/No conversations on this page/)).toBeTruthy();
    expect(mock.history.get.map((item) => item.params)).toEqual([{ page: 1, limit: 5 }, { page: 2, limit: 5 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await screen.findByText('Page 1');
    expect(mock.history.get).toHaveLength(3);
  });
  it('discards stale detail responses and cancels detail loading when New chat is selected', async () => {
    const slow = deferred();
    mock.onGet('/chat/history').reply((config) => config.params?.conversationId === firstId ? slow.promise :
      [200, config.params?.conversationId ? success(second) : list([first, second])]);
    mount(); await login();
    fireEvent.click(await screen.findByRole('button', { name: /Account support/ }));
    await screen.findByText('Loading conversation...');
    fireEvent.click(screen.getByRole('button', { name: /Billing question/ }));
    await screen.findByText('Billing answer');
    await act(async () => slow.resolve([200, success(first)]));
    expect(screen.queryByText('Saved answer')).toBeNull();
    expect(screen.getByText('Billing answer')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(screen.getByRole('heading', { name: 'New conversation' })).toBeTruthy();
  });
  it.each([200, 503])('ignores a late %s detail response after starting a new chat', async (status) => {
    const slow = deferred();
    mock.onGet('/chat/history').reply((config) => config.params?.conversationId ? slow.promise : [200, list([first])]);
    mount(); await login(); draft('New draft');
    fireEvent.click(await screen.findByRole('button', { name: /Account support/ }));
    await screen.findByText('Loading conversation...');
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await act(async () => slow.resolve([status, status === 200 ? success(first) : failure('DATABASE_UNAVAILABLE')]));
    expect(screen.getByRole('heading', { name: 'New conversation' })).toBeTruthy();
    expect(screen.queryByText('Saved answer')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value).toBe('New draft');
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).disabled).toBe(false);
  });
  it('keeps full conversations readable and offers a new chat', async () => {
    const full = { ...first, messages: Array.from({ length: 100 }, (_, i) => pair('Question ' + i, 'Answer ' + i, i * 2)).flat() };
    mock.onGet('/chat/history').reply((config) => [200, config.params?.conversationId ? success(full) : list([first])]);
    mount(); await login(); await select();
    expect(screen.getByText(/has reached 100 replies/)).toBeTruthy();
    expect(screen.getByText('Answer 99')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Start a new chat' }));
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).disabled).toBe(false);
  });
});

describe('UI-04 failures and explicit recovery', () => {
  it('clears partial SSE text and retains the draft after a confirmed stream error', async () => {
    mount(); await login();
    const encoder = new TextEncoder();
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: started\ndata: {"conversationId":null}\n\n'));
        controller.enqueue(encoder.encode('event: delta\ndata: {"text":"Temporary"}\n\n'));
        controller.enqueue(encoder.encode('event: error\ndata: {"code":"AI_UNAVAILABLE","message":"safe","outcome":"not_saved"}\n\n'));
        controller.close();
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    draft('Keep after stream failure'); send();
    expect(await screen.findByText(/AI service could not provide/)).toBeTruthy();
    expect(screen.queryByText('Temporary')).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value).toBe('Keep after stream failure');
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it.each(['VALIDATION_ERROR', 'PAYLOAD_TOO_LARGE', 'AI_RATE_LIMITED', 'AI_TIMEOUT', 'AI_UNAVAILABLE', 'AI_REQUEST_FAILED', 'AI_RESPONSE_INVALID'])(
    'retains the draft for %s without fabricating an exchange or retrying', async (code) => {
      sendMock.onPost('/chat/send').reply(502, failure(code));
      mount(); await login(); draft('  Keep this draft  '); send();
      await screen.findByRole('alert');
      expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value).toBe('  Keep this draft  ');
      expect(screen.queryByRole('article')).toBeNull();
      expect(screen.queryByText('private-error-marker')).toBeNull();
      expect(sends()).toHaveLength(1);
    },
  );
  it.each(['network', 'timeout', 'database', 'malformed'])('requires saved-history recovery for an uncertain %s outcome', async (mode) => {
    if (mode === 'network') sendMock.onPost('/chat/send').networkError();
    if (mode === 'timeout') sendMock.onPost('/chat/send').timeout();
    if (mode === 'database') sendMock.onPost('/chat/send').reply(503, failure('DATABASE_UNAVAILABLE'));
    if (mode === 'malformed') sendMock.onPost('/chat/send').reply(200, { success: true, data: {} });
    mount(); await login(); draft(); send();
    expect(await screen.findByText(/could not confirm whether your message was saved/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved history' }));
    await screen.findByText(/Saved history reloaded/);
    expect(sends()).toHaveLength(1);
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value).toBe('New question');
  });
  it('releases the send lock after failure and allows one explicit retry', async () => {
    const pending = deferred();
    sendMock.onPost('/chat/send').replyOnce(() => pending.promise);
    mount(); await login(); draft(); send(); send();
    await screen.findByRole('status', { name: 'Assistant is typing' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Your message' }), { key: 'Enter', ctrlKey: true });
    expect(sends()).toHaveLength(1);
    await act(async () => pending.resolve([503, failure('AI_UNAVAILABLE')]));
    await screen.findByRole('alert');
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(false);
    sendMock.onPost('/chat/send').reply(200, success(saved()));
    send(); await screen.findByText('New answer');
    expect(sends()).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('keeps an uncertain draft blocked when history reconciliation fails', async () => {
    sendMock.onPost('/chat/send').networkError();
    mount(); await login(); draft(); send();
    await screen.findByText(/could not confirm whether your message was saved/);
    mock.onGet('/chat/history').reply(503, failure('DATABASE_UNAVAILABLE'));
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved history' }));
    await screen.findByText(/Saved conversations could not be loaded/);
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value).toBe('New question');
    expect(sends()).toHaveLength(1);
  });
  it('reloads a conflicted transcript before permitting a manual resend', async () => {
    useHistory();
    sendMock.onPost('/chat/send').reply(409, failure('CONVERSATION_CHANGED'));
    mount(); await login(); await select(); draft('My continuation'); send();
    await screen.findByText(/changed elsewhere/);
    fireEvent.click(screen.getByRole('button', { name: 'Reload saved history' }));
    await screen.findByText(/Saved history reloaded/);
    expect(mock.history.get.filter((item) => item.params?.conversationId)).toHaveLength(2);
    expect(sends()).toHaveLength(1);
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value).toBe('My continuation');
  });
  it('retains a confirmed pair and cleared draft if the summary refresh fails', async () => {
    sendMock.onPost('/chat/send').reply(200, success(saved()));
    mount(); await login(); await screen.findByText(/No saved conversations yet/);
    mock.onGet('/chat/history').reply(503, failure('DATABASE_UNAVAILABLE'));
    draft(); send();
    expect(await screen.findByText('New answer')).toBeTruthy();
    await screen.findByText(/Saved conversations could not be loaded/);
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value).toBe('');
    mock.onGet('/chat/history').reply(200, list([first]));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
    await screen.findByRole('button', { name: /Account support/ });
    expect(sends()).toHaveLength(1);
    expect(screen.getByText('New answer')).toBeTruthy();
  });
  it('allows retrying failed history and detail reads while preventing blind continuation', async () => {
    mock.onGet('/chat/history').reply(503, failure('DATABASE_UNAVAILABLE'));
    mount(); await login();
    await screen.findByText(/Saved conversations could not be loaded/);
    useHistory(); fireEvent.click(screen.getByRole('button', { name: 'Refresh history' }));
    await screen.findByRole('button', { name: /Account support/ });
    mock.onGet('/chat/history').reply(404, failure('CONVERSATION_NOT_FOUND'));
    fireEvent.click(screen.getByRole('button', { name: /Account support/ }));
    await screen.findByText(/This conversation could not be loaded/);
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).disabled).toBe(true);
    useHistory(); fireEvent.click(screen.getByRole('button', { name: 'Reload conversation' }));
    await screen.findByText('Saved answer');
  });
});

describe('UI-05/06/07 security and access', () => {
  it('discards active streamed text and ignores terminal events after logout', async () => {
    mount(); await login();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    vi.stubGlobal('fetch', async () => new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; } }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    draft('Private streaming draft'); send();
    await waitFor(() => expect(controller).toBeTruthy());
    await act(async () => {
      controller?.enqueue(encoder.encode('event: started\ndata: {"conversationId":null}\n\n'));
      controller?.enqueue(encoder.encode('event: delta\ndata: {"text":"Private partial"}\n\n'));
    });
    await screen.findByText('Private partial');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(screen.queryByText('Private partial')).toBeNull();
    await act(async () => {
      try {
        controller?.enqueue(encoder.encode(`event: committed\ndata: ${JSON.stringify(saved('Private streaming draft', 'Private partial'))}\n\n`));
        controller?.close();
      } catch { /* canceled streams reject late producer writes */ }
    });
    expect(screen.queryByText('Private partial')).toBeNull();
  });
  it('escapes malicious text in both roles and provides privacy, keyboard and validation affordances', async () => {
    const malicious = '<img src=x onerror=alert(1)>';
    sendMock.onPost('/chat/send').reply(200, success(saved(malicious, '<script>alert(1)</script>')));
    const storage = vi.spyOn(Storage.prototype, 'setItem');
    mount(); await login();
    expect(screen.getByText(/external AI provider/)).toBeTruthy();
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'Your message' });
    input.focus();
    await user.type(input, malicious);
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(await screen.findByText('<script>alert(1)</script>')).toBeTruthy();
    expect(screen.getByText(malicious).querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(storage).not.toHaveBeenCalled();
    expect(validateMessage({ message: '\0'.repeat(4000) })).toMatch(/too large/);
    draft('a'.repeat(4001));
    expect(screen.getByRole('textbox', { name: 'Your message' }).getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it.each([['send', 200], ['detail', 200], ['list', 200], ['send', 401], ['detail', 401], ['list', 401]] as const)('ignores a delayed %s response %s after logout and account change', async (kind, status) => {
    const late = deferred();
    useHistory();
    mount(); await login(); await select(); draft('Account A private draft');
    if (kind === 'send') { sendMock.onPost('/chat/send').reply(() => late.promise); send(); await screen.findByRole('status', { name: 'Assistant is typing' }); }
    if (kind === 'detail') { mock.onGet('/chat/history').reply(() => late.promise); fireEvent.click(screen.getByRole('button', { name: /Billing question/ })); await screen.findByText('Loading conversation...'); }
    if (kind === 'list') { mock.onGet('/chat/history').reply(() => late.promise); fireEvent.click(screen.getByRole('button', { name: 'Refresh history' })); await screen.findByText('Loading conversations...'); }
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(screen.queryByText('Saved answer')).toBeNull();
    mock.onGet('/chat/history').reply(200, list());
    await login('b@example.test');
    await act(async () => late.resolve([status, kind === 'send' ? success(saved('Private A', 'Private A reply')) : kind === 'detail' ? success(first) : list([first])]));
    expect(screen.queryByText('Private A reply')).toBeNull();
    expect(screen.queryByText('Saved answer')).toBeNull();
    expect(screen.queryByRole('button', { name: /Account support/ })).toBeNull();
    expect((screen.getByRole('textbox', { name: 'Your message' }) as HTMLTextAreaElement).value).toBe('');
  });
  it.each(['401', 'expiry'])('clears transcript and drafts on %s', async (mode) => {
    useHistory(); mount(); await login(); await select(); draft('Private draft');
    if (mode === '401') {
      sendMock.onPost('/chat/send').reply(401, failure('UNAUTHORIZED')); send();
    } else {
      const future = Date.now() + 3600001;
      vi.spyOn(Date, 'now').mockReturnValue(future);
      fireEvent.focus(window);
    }
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(screen.queryByText('Saved answer')).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Your message' })).toBeNull();
  });
  it('exposes usable history navigation with focus returning to the chat heading', async () => {
    mount(); await login();
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'History' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'History' }).getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('complementary', { name: 'Conversation history' })));
    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'New conversation' })));
    expect(screen.getByRole('textbox', { name: 'Your message' }).getAttribute('aria-describedby')).toContain('message-privacy');
  });
});
