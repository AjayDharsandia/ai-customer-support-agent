import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import axios from 'axios';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { validateAuthForm } from '../auth/validation';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const { user, login, signup } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState('');
  const active = useRef(true);
  const submitting = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  if (user) return <Navigate to="/chat" replace />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting.current) return;
    const input = { email: email.trim().toLowerCase(), password };
    const validation = validateAuthForm(input);
    setErrors(validation);
    setError('');
    if (Object.keys(validation).length) return;
    submitting.current = true;
    setPending(true);
    try {
      await (mode === 'signup' ? signup(input) : login(input));
      if (active.current) setPassword('');
    } catch (failure: unknown) {
      if (!active.current || axios.isCancel(failure)) return;
      const status = axios.isAxiosError(failure) ? failure.response?.status : undefined;
      setError(status === 401 ? 'Invalid email or password.' :
        status === 409 ? 'An account with this email already exists.' :
        status === 400 ? 'Please check your email and password.' :
        status === 503 ? 'The service is temporarily unavailable. Please try again.' :
        'Unable to sign in right now. Please try again.');
    } finally {
      submitting.current = false;
      if (active.current) setPending(false);
    }
  };

  return (
    <section className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
      <p className="text-sm font-semibold uppercase tracking-widest text-teal-700">Customer Support</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{mode === 'signup' ? 'Create your account' : 'Welcome back'}</h1>
      <p className="mt-3 text-sm text-slate-600">Keep your support conversations in one place.</p>
      <form onSubmit={(event) => { void submit(event); }} noValidate className="mt-8 space-y-5" aria-busy={pending}>
        <div>
          <label htmlFor="email" className="block text-sm font-medium">Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" value={email}
            onChange={(event) => setEmail(event.target.value)} disabled={pending}
            aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'email-error' : undefined}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 disabled:bg-slate-50" />
          {errors.email && <p id="email-error" className="mt-1 text-sm text-red-700">{errors.email}</p>}
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium">Password</label>
          <input id="password" name="password" type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password} onChange={(event) => setPassword(event.target.value)} disabled={pending}
            aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? 'password-error' : 'password-help'}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 disabled:bg-slate-50" />
          {errors.password ? <p id="password-error" className="mt-1 text-sm text-red-700">{errors.password}</p> :
            <p id="password-help" className="mt-1 text-xs text-slate-500">At least 8 characters; at most 72 UTF-8 bytes.</p>}
        </div>
        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <button type="submit" disabled={pending} className="w-full rounded-lg bg-teal-800 px-4 py-3 font-semibold text-white hover:bg-teal-900 disabled:opacity-60">
          {pending ? 'Please wait...' : mode === 'signup' ? 'Create account' : 'Sign in'}
        </button>
      </form>
      <p className="mt-6 text-sm text-slate-600">
        {mode === 'signup' ? 'Already have an account? ' : 'New to Customer Support? '}
        <Link to={mode === 'signup' ? '/login' : '/signup'} className="font-semibold text-teal-800 underline">
          {mode === 'signup' ? 'Sign in' : 'Create an account'}
        </Link>
      </p>
    </section>
  );
}
