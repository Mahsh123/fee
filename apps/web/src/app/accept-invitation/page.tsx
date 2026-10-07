'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, KeyRound, MailCheck } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api';
import { useTenant } from '../../components/tenant-provider';

export default function AcceptInvitationPage() {
  const tenant = useTenant();
  const platformHost = tenant.kind === 'platform';
  const [token, setToken] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const value = window.location.hash.slice(1);
    setToken(value);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    setReady(true);
  }, []);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirmPassword = String(form.get('confirmPassword') ?? '');
    if (password !== confirmPassword) { setError('The passwords do not match.'); setBusy(false); return; }
    try {
      await apiRequest('/auth/accept-invitation', { method: 'POST', body: JSON.stringify({ token, password }) });
      setAccepted(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : `This invitation could not be accepted. Ask your ${platformHost ? 'platform' : 'organization'} administrator to send a new one.`);
    } finally { setBusy(false); }
  }

  return <main id="main-content" className="auth-page">
    <section className="auth-card surface-panel">
      <div className="auth-brand-mark"><MailCheck size={24} /></div>
      {accepted ? <>
        <p className="eyebrow">INVITATION ACCEPTED</p>
        <h1>Your account is ready</h1>
        <p className="muted">{platformHost ? 'Your email is verified. Sign in to the platform control plane with the password you just created.' : 'Your email is verified. Sign in to your organization workspace with the password you just created.'}</p>
        <Link className="button button-primary auth-submit" href="/login">Continue to sign in <ArrowRight size={16} /></Link>
      </> : <>
        <p className="eyebrow">{platformHost ? 'PLATFORM ACCESS' : 'WORKSPACE ACCESS'}</p>
        <h1>{platformHost ? 'Accept your platform invitation' : 'Accept your invitation'}</h1>
        <p className="muted">{platformHost ? 'Choose a password to activate your platform administrator account.' : 'Choose a password to activate your organization account.'}</p>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        {!ready ? <p className="muted">Checking invitation link…</p> : !token ? <div className="notice notice-error" role="alert">This invitation link is missing or expired. Ask your {platformHost ? 'platform' : 'organization'} administrator to send a new one.</div> : <form className="auth-form" onSubmit={accept}>
          <label htmlFor="password">New password</label>
          <div className="auth-input-wrap"><KeyRound size={17} /><input id="password" name="password" type="password" minLength={12} maxLength={200} autoComplete="new-password" required /></div>
          <small>Use at least 12 characters.</small>
          <label htmlFor="confirmPassword">Confirm password</label>
          <div className="auth-input-wrap"><Check size={17} /><input id="confirmPassword" name="confirmPassword" type="password" minLength={12} maxLength={200} autoComplete="new-password" required /></div>
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Activating account…' : 'Accept invitation'} <ArrowRight size={16} /></button>
        </form>}
      </>}
    </section>
  </main>;
}
