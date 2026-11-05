import { SessionStatus } from './auth/SessionStatus';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AuthPage } from './pages/AuthPage';
import { ChatPage } from './pages/ChatPage';
import { ScaffoldPage } from './components/ScaffoldPage';

export default function App() {
  const { user, logout, status, sessionError } = useAuth();
  if (status === 'checking') return <SessionStatus />;
  return (
    <div className="min-h-dvh bg-slate-100/70 text-slate-900">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:block focus:p-4">Skip to content</a>
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="shrink-0">
            <span className="text-xl font-bold tracking-tight">Customer Support<span className="text-teal-600"> Agent</span></span>
            <span className="ml-3 hidden border-l border-slate-200 pl-3 text-sm text-slate-500 sm:inline">Support workspace</span>
          </div>
          {user ? (
            <div className="flex min-w-0 items-center gap-3">
              <p className="max-w-28 truncate text-xs text-slate-500 sm:max-w-xs sm:text-sm" title={user.email}>{user.email}</p>
              <button type="button" onClick={logout} className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold hover:bg-slate-50">Sign out</button>
            </div>
          ) : (
            <nav aria-label="Main navigation" className="flex gap-1 text-sm">
              {[{ to: '/login', label: 'Sign in' }, { to: '/signup', label: 'Create account' }].map(({ to, label }) => (
                <NavLink key={to} to={to} className={({ isActive }) =>
                  'rounded-lg px-3 py-2 font-medium ' + (isActive ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-100')
                }>{label}</NavLink>
              ))}
            </nav>
          )}
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className={user ? 'mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-6' : 'mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-20'}>
        {sessionError && <SessionStatus />}
        <Routes>
          <Route path="/" element={<Navigate to={user ? '/chat' : '/login'} replace />} />
          <Route path="/login" element={<AuthPage key="login" mode="login" />} />
          <Route path="/signup" element={<AuthPage key="signup" mode="signup" />} />
          <Route element={<ProtectedRoute />}><Route path="/chat" element={<ChatPage />} /></Route>
          <Route path="*" element={<ScaffoldPage title="Page not found" description="Choose a page from the navigation to continue." />} />
        </Routes>
      </main>
    </div>
  );
}
