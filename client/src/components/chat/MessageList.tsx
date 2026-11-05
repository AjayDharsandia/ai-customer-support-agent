import { useEffect, useRef } from 'react';
import type { ChatMessage, StreamingExchange } from '../../types/api';

function Dots() {
  return <span role="status" aria-label="Assistant is typing" className="inline-flex items-center gap-1 py-1">
    <span className="sr-only">Assistant is typing</span>
    {[0, 1, 2].map((index) => <span key={index} aria-hidden="true"
      className="size-1.5 animate-bounce rounded-full bg-teal-700"
      style={{ animationDelay: `${index * 140}ms` }} />)}
  </span>;
}
export function MessageList({ messages, conversationId, streaming }: {
  messages: ChatMessage[]; conversationId: string | null; streaming: StreamingExchange | null;
}) {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView?.({ block: 'end' }); },
    [messages.length, conversationId, streaming?.assistantContent]);
  const hasMessages = messages.length > 0 || streaming !== null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8">
      {!hasMessages ? (
        <div className="mx-auto flex min-h-64 max-w-md flex-col items-center justify-center py-10 text-center">
          <div aria-hidden="true" className="mb-6 flex size-14 items-center justify-center rounded-2xl bg-teal-50 text-2xl font-semibold text-teal-800">CS</div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">How can we help?</h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">Ask a question, describe a problem, or pick up a saved conversation. We will work through it together.</p>
        </div>
      ) : (
        <ol aria-label="Conversation messages" className="mx-auto max-w-3xl space-y-7">
          {messages.map((message) => (
            <li key={message.id} className={'flex ' + (message.role === 'user' ? 'justify-end' : 'justify-start')}>
              <article aria-label={message.role === 'user' ? 'Your message' : 'Assistant message'}
                className={'min-w-0 max-w-[92%] sm:max-w-[85%] ' + (message.role === 'user' ? 'text-right' : '')}>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500">
                  {message.role === 'assistant' && <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-lg bg-teal-800 text-white">CS</span>}
                  <span className={message.role === 'user' ? 'ml-auto' : ''}>{message.role === 'user' ? 'You' : 'Support assistant'}</span>
                  <time dateTime={message.createdAt} className="font-normal">{new Date(message.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time>
                </div>
                <p className={'whitespace-pre-wrap rounded-2xl px-4 py-3 text-left text-sm leading-7 [overflow-wrap:anywhere] sm:px-5 ' +
                  (message.role === 'user' ? 'rounded-tr-sm bg-teal-800 text-white' : 'rounded-tl-sm border border-slate-200 bg-slate-50 text-slate-800')}>
                  {message.content}
                </p>
              </article>
            </li>
          ))}
          {streaming && <>
            <li className="flex justify-end">
              <article aria-label="Your message (saving)" className="min-w-0 max-w-[92%] text-right opacity-80 sm:max-w-[85%]">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500">
                  <span className="ml-auto">You</span><span>Saving…</span>
                </div>
                <p className="whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-teal-800 px-4 py-3 text-left text-sm leading-7 text-white [overflow-wrap:anywhere] sm:px-5">
                  {streaming.userContent}
                </p>
              </article>
            </li>
            <li className="flex justify-start">
              <article aria-label="Assistant message (streaming)" className="min-w-0 max-w-[92%] sm:max-w-[85%]">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500">
                  <span aria-hidden="true" className="flex size-6 items-center justify-center rounded-lg bg-teal-800 text-white">CS</span>
                  <span>Support assistant</span><span>Generating…</span>
                </div>
                <p aria-live="polite" aria-atomic="false"
                  className="whitespace-pre-wrap rounded-2xl rounded-tl-sm border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm leading-7 text-slate-800 [overflow-wrap:anywhere] sm:px-5">
                  {streaming.assistantContent ? <>{streaming.assistantContent}<span aria-hidden="true" className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-teal-700 align-text-bottom" /></> : <Dots />}
                </p>
              </article>
            </li>
          </>}
        </ol>
      )}
      <div ref={bottom} />
    </div>
  );
}
