import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AuthContext } from './AuthContext';
import { createSession, initialSession } from './session';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initialSession);
  const [session] = useState(() => createSession(setState));
  useEffect(() => session.start(), [session]);
  return (
    <AuthContext.Provider value={{
      user: state.session?.user ?? null, generation: state.generation,
      status: state.status, sessionError: state.error, retrySession: session.retry,
      login: session.login, signup: session.signup, logout: session.logout,
    }}>{children}</AuthContext.Provider>
  );
}
