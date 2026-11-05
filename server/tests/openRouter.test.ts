import { afterEach, describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { mockProvider } from './helpers/mockProvider.js';
import { createOpenRouter, OPENROUTER_URL, SUPPORT_PROMPT } from '../src/services/openRouter.js';
import type { AIMessage } from '../src/services/openRouter.js';

const provider = createOpenRouter({ openRouterApiKey: 'synthetic-provider-secret', openRouterModel: 'openrouter/free' });
const mock = mockProvider(provider.client);
afterEach(() => mock.reset());
const response = (content: unknown) => ({ choices: [{ message: { content, reasoning: 'hidden' } }] });

describe('AI-01 through AI-05 provider boundary', () => {
  it('uses the fixed endpoint, prompt, last ten pairs, private key and bounded generation', async () => {
    const history: AIMessage[] = Array.from({ length: 24 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user', content: 'saved-' + index,
    }));
    mock.onPost(OPENROUTER_URL).reply(200, response('  Helpful text  '));
    expect(await provider.generateReply(history, 'Current')).toBe('Helpful text');
    const call = mock.history.post[0];
    const body: unknown = JSON.parse(call?.data as string);
    expect(body).toEqual({ model: 'openrouter/free', stream: false, max_tokens: 512,
      messages: [{ role: 'system', content: SUPPORT_PROMPT }, ...history.slice(4), { role: 'user', content: 'Current' }] });
    expect(call?.timeout).toBe(30000);
    expect(call?.signal).toBeDefined();
    expect(call?.maxRedirects).toBe(0);
    expect(call?.headers?.Authorization).toBe('Bearer synthetic-provider-secret');
    expect(mock.history.post).toHaveLength(1);
  });
  it.each([
    [504, 504, 'AI_TIMEOUT'], [429, 429, 'AI_RATE_LIMITED'], [503, 503, 'AI_UNAVAILABLE'],
    [401, 502, 'AI_REQUEST_FAILED'], [402, 502, 'AI_REQUEST_FAILED'],
    [400, 502, 'AI_REQUEST_FAILED'], [404, 502, 'AI_REQUEST_FAILED'], [500, 502, 'AI_REQUEST_FAILED'],
  ])('maps provider %s without exposing provider details or retrying', async (upstream, status, code) => {
    mock.onPost().reply(upstream, { error: { message: 'private-upstream-marker' } });
    await expect(provider.generateReply([], 'Help')).rejects.toMatchObject({ status, code });
    expect(mock.history.post).toHaveLength(1);
  });
  it('maps network timeout and network failure without retrying', async () => {
    mock.onPost().timeoutOnce();
    await expect(provider.generateReply([], 'Help')).rejects.toMatchObject({ status: 504, code: 'AI_TIMEOUT' });
    mock.onPost().networkErrorOnce();
    await expect(provider.generateReply([], 'Help')).rejects.toMatchObject({ status: 503, code: 'AI_UNAVAILABLE' });
    expect(mock.history.post).toHaveLength(2);
  });
  it.each([null, {}, { choices: [] }, response(''), response('  '), response(null), response(['text']),
    response('a'.repeat(16001)), { ...response('valid'), error: { message: 'hidden' } }])('rejects invalid successful bodies', async (body) => {
    mock.onPost().reply(200, body);
    await expect(provider.generateReply([], 'Help')).rejects.toMatchObject({ status: 502, code: 'AI_RESPONSE_INVALID' });
    expect(mock.history.post).toHaveLength(1);
  });
  it('accepts a nonempty answer at the Unicode bound or token budget', async () => {
    mock.onPost().reply(200, { choices: [{ finish_reason: 'length', message: { content: '\u{1F600}'.repeat(16000) } }] });
    expect(Array.from(await provider.generateReply([], 'Help'))).toHaveLength(16000);
  });
});

describe('OpenRouter streaming boundary', () => {
  function fragmentedStream(text: string, cuts: number[]) {
    const bytes = Buffer.from(text);
    const chunks: Buffer[] = [];
    let start = 0;
    for (const end of cuts) { chunks.push(bytes.subarray(start, end)); start = end; }
    chunks.push(bytes.subarray(start));
    return Readable.from(chunks);
  }
  it('parses fragmented SSE and UTF-8 boundaries while forwarding genuine deltas', async () => {
    const wire = ': processing\r\ndata: {"choices":[{"delta":{"content":"Hello "}}]}\r\n\r\n' +
      'data: {"choices":[{"delta":{"content":"😀"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n';
    const emoji = Buffer.from(wire).indexOf(Buffer.from('😀'));
    mock.onPost(OPENROUTER_URL).reply(200, fragmentedStream(wire, [1, 7, 31, emoji + 1, emoji + 3]));
    const deltas: string[] = [];
    const result = await provider.generateReplyStream([], 'Current', async (text) => { deltas.push(text); }, new AbortController().signal);
    expect(result).toBe('Hello 😀 world');
    expect(deltas).toEqual(['Hello ', '😀', ' world']);
    const call = mock.history.post[0];
    expect(JSON.parse(call?.data as string)).toMatchObject({ stream: true, max_tokens: 512 });
    expect(call?.responseType).toBe('stream');
    expect(call?.headers?.Authorization).toBe('Bearer synthetic-provider-secret');
  });
  it.each([
    ['data: {"error":{"code":429,"message":"private"}}\n\ndata: [DONE]\n\n', 'AI_RATE_LIMITED'],
    ['data: {not-json}\n\n', 'AI_RESPONSE_INVALID'],
    ['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', 'AI_RESPONSE_INVALID'],
    ['data: [DONE]\n\n', 'AI_RESPONSE_INVALID'],
  ])('rejects provider stream failures without fabricating completion (%#)', async (wire, code) => {
    mock.onPost().reply(200, Readable.from([wire]));
    const deltas: string[] = [];
    await expect(provider.generateReplyStream([], 'Help', async (text) => { deltas.push(text); }, new AbortController().signal))
      .rejects.toMatchObject({ code });
    expect(mock.history.post).toHaveLength(1);
  });
  it('stops a disconnected stream and does not consume later fragments', async () => {
    const controller = new AbortController();
    async function* chunks() {
      yield 'data: {"choices":[{"delta":{"content":"first"}}]}\n\n';
      yield 'data: {"choices":[{"delta":{"content":"second"}}]}\n\ndata: [DONE]\n\n';
    }
    mock.onPost().reply(200, Readable.from(chunks()));
    const deltas: string[] = [];
    await expect(provider.generateReplyStream([], 'Help', async (text) => { deltas.push(text); controller.abort(); }, controller.signal))
      .rejects.toMatchObject({ name: 'StreamAbortedError' });
    expect(deltas).toEqual(['first']);
  });
});
