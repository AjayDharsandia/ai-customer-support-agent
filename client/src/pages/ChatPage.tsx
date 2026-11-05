import { useRef, useState } from 'react';
import { useChat } from '../chat/useChat';
import { ConversationSidebar } from '../components/chat/ConversationSidebar';
import { MessageList } from '../components/chat/MessageList';
import { MessageComposer } from '../components/chat/MessageComposer';

export function ChatPage() {
  const chat = useChat();
  const [historyOpen, setHistoryOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const openHistory = () => {
    setHistoryOpen(true);
    requestAnimationFrame(() => sidebar.current?.focus());
  };
  const closeHistory = () => {
    setHistoryOpen(false);
    requestAnimationFrame(() => heading.current?.focus());
  };
  const openConversation = (id: string) => { chat.selectConversation(id); closeHistory(); };
  const startNew = () => { chat.newChat(); closeHistory(); };
  return (
    <div className="grid h-[calc(100dvh-7rem)] min-h-[34rem] grid-cols-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:h-[calc(100dvh-8rem)] md:min-h-[32rem] md:grid-cols-[18rem_minmax(0,1fr)]">
      <aside ref={sidebar} tabIndex={-1} id="conversation-sidebar" aria-label="Conversation history"
        className={(historyOpen ? 'flex' : 'hidden') + ' min-h-0 flex-col bg-slate-50 md:flex md:border-r md:border-slate-200'}>
        <ConversationSidebar history={chat.history} loading={chat.historyLoading} error={chat.historyError}
          selectedId={chat.selectedId} locked={chat.sending || chat.recovering} onSelect={openConversation}
          onNew={startNew} onPage={chat.changePage} onRefresh={chat.refreshHistory} onClose={closeHistory} />
      </aside>
      <section aria-label="Support chat" className={(historyOpen ? 'hidden' : 'flex') + ' min-h-0 min-w-0 flex-col md:flex'}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-teal-700">AI customer support</p>
            <h1 ref={heading} tabIndex={-1} className="truncate text-lg font-semibold tracking-tight text-slate-900">
              {chat.conversation?.title ?? (chat.selectedId ? 'Saved conversation' : 'New conversation')}
            </h1>
          </div>
          <button type="button" aria-controls="conversation-sidebar" aria-expanded={historyOpen}
            onClick={openHistory} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 md:hidden">
            History
          </button>
        </div>
        {chat.detailLoading ? <p role="status" className="flex-1 p-8 text-sm text-slate-600">Loading conversation...</p> :
          chat.detailError ? <div className="flex-1 p-8"><p role="alert" className="text-sm text-red-800">{chat.detailError}</p>
            <button type="button" onClick={chat.retryDetail} className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold">Reload conversation</button></div> :
            <MessageList messages={chat.conversation?.messages ?? []} conversationId={chat.selectedId} streaming={chat.streaming} />}
        <div aria-live="polite" role="status" className="px-4 text-sm text-teal-800 sm:px-6">
          {chat.announcement ? <p className="sr-only">{chat.announcement}</p> : null}
        </div>
        {chat.issue && <div role="alert" className="mx-4 mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950 sm:mx-6">
          <p>{chat.issue.message}</p>
          {chat.issue.recovery === 'reload' && <button type="button" disabled={chat.recovering}
            onClick={() => { if (!chat.selectedId) openHistory(); void chat.reloadSaved(); }}
            className="mt-2 rounded-lg border border-amber-400 bg-white px-3 py-2 font-semibold disabled:opacity-50">
            {chat.recovering ? 'Reloading saved history...' : 'Reload saved history'}
          </button>}
          {chat.issue.recovery === 'new' && <button type="button" onClick={startNew} className="mt-2 font-semibold underline">Start a new chat</button>}
        </div>}
        {chat.full && !chat.issue && <p role="status" className="mx-4 mb-3 rounded-lg bg-teal-50 p-3 text-sm text-teal-900 sm:mx-6">
          This conversation has reached 100 replies. <button type="button" onClick={startNew} className="font-semibold underline">Start a new chat</button> to continue.
        </p>}
        <MessageComposer draft={chat.draft} disabled={chat.blocked} sending={chat.sending}
          onChange={chat.updateDraft} onSend={() => { void chat.submit(); }} />
      </section>
    </div>
  );
}
