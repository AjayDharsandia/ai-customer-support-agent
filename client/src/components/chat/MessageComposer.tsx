import { useEffect, useRef } from 'react';

interface Props { draft: string; disabled: boolean; sending: boolean; onChange: (value: string) => void; onSend: () => void }
export function MessageComposer({ draft, disabled, sending, onChange, onSend }: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const previousSending = useRef(sending);
  useEffect(() => {
    if (previousSending.current && !sending && !disabled) textarea.current?.focus();
    previousSending.current = sending;
  }, [sending, disabled]);
  const count = Array.from(draft.trim()).length;
  return (
    <form aria-label="Send a support message" noValidate onSubmit={(event) => { event.preventDefault(); onSend(); }}
      className="border-t border-slate-200 bg-white px-4 pb-4 pt-4 sm:px-6">
      <label htmlFor="chat-message" className="mb-2 block text-sm font-semibold text-slate-700">Your message</label>
      <div className="rounded-xl border border-slate-300 bg-white p-3 focus-within:border-teal-700 focus-within:ring-1 focus-within:ring-teal-700">
        <textarea ref={textarea} id="chat-message" value={draft} rows={3} disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
              event.preventDefault(); onSend();
            }
          }}
          aria-describedby="message-help message-privacy" aria-invalid={count > 4000}
          placeholder="Tell us what you need help with..."
          className="block w-full resize-y border-0 bg-transparent text-base leading-6 text-slate-800 placeholder:text-slate-400 disabled:opacity-60 sm:text-sm" />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p id="message-help" className={'text-xs ' + (count > 4000 ? 'text-red-700' : 'text-slate-500')}>
            {count.toLocaleString()} / 4,000 <span className="hidden sm:inline"> · Ctrl/⌘ + Enter to send</span>
          </p>
          <button type="submit" disabled={disabled || !draft.trim() || count > 4000}
            className="rounded-lg bg-teal-800 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-900 disabled:opacity-50">
            {sending ? 'Sending...' : 'Send message'}
          </button>
        </div>
      </div>
      <p id="message-privacy" className="mt-3 text-xs leading-5 text-slate-500">
        Messages are sent to an external AI provider. Avoid sharing passwords, payment details, or other sensitive information. AI guidance can be mistaken.
      </p>
    </form>
  );
}
