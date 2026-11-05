import { createContext, useContext } from 'react';
import type { AuthRequest, PublicUser } from '../types/api';

export interface AuthContextValue {
  user: PublicUser | null;
  status: 'checking' | 'authenticated' | 'unauthenticated';
  sessionError: string;
  retrySession: () => void;
  generation: number;
  login: (input: AuthRequest) => Promise<void>;
  signup: (input: AuthRequest) => Promise<void>;
  logout: () => void;
}
export const AuthContext = createContext<AuthContextValue | null>(null);
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('Authentication provider is missing.');
  return value;
}
