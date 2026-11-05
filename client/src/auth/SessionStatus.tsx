import { useAuth } from './AuthContext';
export function SessionStatus() {
  const { sessionError, retrySession } = useAuth();
  return <section aria-label="Session status" className="mx-auto my-8 max-w-lg rounded-xl border border-slate-200 bg-white p-6">
    {sessionError ? <><p role="alert">{sessionError}</p><button type="button" onClick={retrySession}
      className="mt-4 rounded-lg bg-teal-800 px-4 py-2 text-white">Retry session action</button></> :
      <p role="status">Restoring your session...</p>}
  </section>;
}
