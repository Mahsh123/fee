'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { ArrowLeft, Mail } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api';
import { useTenant } from '../../components/tenant-provider';

export default function ForgotPasswordPage() {
  const tenant = useTenant();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim();
    try {
      await apiRequest('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      setSubmitted(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'We could not process the request. Please try again.');
    } finally { setBusy(false); }
  }

  const workspaceName = tenant.kind === 'tenant' ? tenant.branding.organizationName : tenant.kind === 'platform' ? 'Wasl platform' : 'your workspace';
  return <main id="main-content" className="auth-page">
    <section className="auth-card surface-panel">
      <div className="auth-brand-mark"><Mail size={24} /></div>
      <p className="eyebrow">ACCOUNT RECOVERY</p>
      <h1>Forgot your password?</h1>
      {submitted ? <>
        <p className="muted">If an active account matches that email, a secure reset link has been sent. Check your inbox and spam folder.</p>
        <Link className="button button-primary auth-submit" href="/login"><ArrowLeft size={16} /> Return to sign in</Link>
      </> : <>
        <p className="muted">Enter your email address and we’ll send a password reset link for {workspaceName} if an active account exists.</p>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <form className="auth-form" onSubmit={submit} aria-busy={busy}>
          <label htmlFor="email">Email address</label>
          <div className="auth-input-wrap"><Mail size={17} /><input id="email" name="email" type="email" autoComplete="username" maxLength={254} required /></div>
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
        </form>
        <Link className="login-back-link" href="/login">Back to sign in</Link>
      </>}
    </section>
  </main>;
}
