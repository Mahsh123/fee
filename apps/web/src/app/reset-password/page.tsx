'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, KeyRound } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api';
import { useTenant } from '../../components/tenant-provider';

export default function ResetPasswordPage() {
  const tenant = useTenant();
  const [token, setToken] = useState('');
  const [ready, setReady] = useState(false);
  const [reset, setReset] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const resetFragmentCaptured = useRef(false);

  useEffect(() => {
    if (resetFragmentCaptured.current) return;
    resetFragmentCaptured.current = true;
    const value = window.location.hash.slice(1);
    setToken(value);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    setReady(true);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirmPassword') ?? '')) { setError('The passwords do not match.'); setBusy(false); return; }
    try {
      await apiRequest('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
      setReset(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'This reset link could not be used. Request a new one.');
    } finally { setBusy(false); }
  }

  const isPlatform = tenant.kind === 'platform';
  return <main id="main-content" className="auth-page">
    <section className="auth-card surface-panel">
      <div className="auth-brand-mark"><KeyRound size={24} /></div>
      {reset ? <>
        <p className="eyebrow">PASSWORD UPDATED</p><h1>You can sign in now</h1>
        <p className="muted">Your password was changed and previous sessions were signed out.</p>
        <Link className="button button-primary auth-submit" href="/login"><ArrowLeft size={16} /> Continue to sign in</Link>
      </> : <>
        <p className="eyebrow">{isPlatform ? 'PLATFORM ACCESS' : 'WORKSPACE ACCESS'}</p>
        <h1>Choose a new password</h1>
        <p className="muted">Use at least 12 characters. This secure link can be used once and expires after 30 minutes.</p>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {!ready ? <p className="muted" role="status">Checking reset link…</p> : !token ? <div className="notice notice-error" role="alert">This reset link is missing or expired. <Link href="/forgot-password">Request another link</Link>.</div> : <form className="auth-form" onSubmit={submit} aria-busy={busy}>
          <label htmlFor="password">New password</label>
          <div className="auth-input-wrap"><KeyRound size={17} /><input id="password" name="password" type="password" minLength={12} maxLength={200} autoComplete="new-password" required /></div>
          <label htmlFor="confirmPassword">Confirm new password</label>
          <div className="auth-input-wrap"><Check size={17} /><input id="confirmPassword" name="confirmPassword" type="password" minLength={12} maxLength={200} autoComplete="new-password" required /></div>
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Updating password…' : 'Set new password'}</button>
        </form>}
        <Link className="login-back-link" href="/login">Back to sign in</Link>
      </>}
    </section>
  </main>;
}
