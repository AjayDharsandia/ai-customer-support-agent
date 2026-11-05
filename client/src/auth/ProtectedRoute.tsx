import { SessionStatus } from './SessionStatus';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

export function ProtectedRoute() {
  const { user, generation, status } = useAuth();
  if (status === 'checking') return <SessionStatus />;
  return user ? <Outlet key={generation} /> : <Navigate to="/login" replace />;
}
