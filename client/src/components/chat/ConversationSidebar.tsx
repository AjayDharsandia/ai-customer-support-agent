import type { HistoryListData } from '../../types/api';

interface Props {
  history: HistoryListData;
  loading: boolean;
  error: string;
  selectedId: string | null;
  locked: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onPage: (page: number) => void;
  onRefresh: () => void;
  onClose: () => void;
}
export function ConversationSidebar({ history, loading, error, selectedId, locked, onSelect, onNew, onPage, onRefresh, onClose }: Props) {
  const { conversations, pagination } = history;
  return (
    <>
      <div className="border-b border-slate-200 p-5">
        <div className="mb-5 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">Your conversations</h2>
          <button type="button" onClick={onClose} className="text-sm font-medium text-teal-800 underline md:hidden">Back to chat</button>
        </div>
        <button type="button" onClick={onNew} disabled={locked}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-800 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50">
          <span aria-hidden="true" className="text-lg leading-none">+</span> New chat
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4">
        <div className="mb-3 flex items-center justify-between px-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Saved history</p>
          <button type="button" onClick={onRefresh} disabled={locked || loading}
            className="rounded px-2 py-1 text-xs font-semibold text-teal-800 hover:bg-teal-50 disabled:opacity-50">Refresh history</button>
        </div>
        {loading && <p role="status" className="px-2 py-3 text-sm text-slate-600">Loading conversations...</p>}
        {error && <p role="alert" className="mx-2 mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">{error}</p>}
        {!loading && !error && conversations.length === 0 && (
          <p className="px-2 py-4 text-sm leading-relaxed text-slate-500">
            {pagination.page === 1 ? 'No saved conversations yet. Your first reply will start one.' : 'No conversations on this page. Go back to a previous page.'}
          </p>
        )}
        <nav aria-label="Saved conversations">
          <ul className="space-y-1">
            {conversations.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => onSelect(item.id)} disabled={locked || loading}
                  aria-current={selectedId === item.id ? 'true' : undefined}
                  className={'w-full rounded-xl border px-3 py-3 text-left disabled:opacity-50 ' + (selectedId === item.id
                    ? 'border-teal-200 bg-teal-50 text-teal-950' : 'border-transparent text-slate-700 hover:border-slate-200 hover:bg-white')}>
                  <span className="line-clamp-2 text-sm font-medium [overflow-wrap:anywhere]">{item.title}</span>
                  <time dateTime={item.updatedAt} className="mt-1.5 block text-xs text-slate-500">
                    {new Date(item.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </time>
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <nav aria-label="Conversation pages" className="flex items-center justify-between gap-2 border-t border-slate-200 p-4 text-sm">
        <button type="button" onClick={() => onPage(pagination.page - 1)} disabled={locked || loading || pagination.page <= 1}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50 disabled:opacity-40">Previous</button>
        <span aria-live="polite" className="text-xs text-slate-500">Page {pagination.page}</span>
        <button type="button" onClick={() => onPage(pagination.page + 1)} disabled={locked || loading || !pagination.hasMore}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 hover:bg-slate-50 disabled:opacity-40">Next</button>
      </nav>
    </>
  );
}
