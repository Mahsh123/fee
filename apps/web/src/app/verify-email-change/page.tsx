'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, MailCheck } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api';
import { useTenant } from '../../components/tenant-provider';

export default function VerifyEmailChangePage() {
  const tenant = useTenant();
  const platformHost = tenant.kind === 'platform';
  const [token, setToken] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const verificationFragmentCaptured = useRef(false);

  useEffect(() => {
    if (verificationFragmentCaptured.current) return;
    verificationFragmentCaptured.current = true;
    const value = window.location.hash.slice(1);
    setToken(value);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !token) return;
    let active = true;
    setBusy(true);
    void apiRequest<{ accepted: true; email: string }>('/auth/accept-email-change', {
      method: 'POST', body: JSON.stringify({ token }),
    }).then((result) => { if (active) setEmail(result.email); })
      .catch((cause) => { if (active) setError(cause instanceof ApiError ? cause.message : 'This email verification link could not be used. Request a new link.'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [ready, token]);

  return <main id="main-content" className="auth-page"><section className="auth-card surface-panel">
    <div className="auth-brand-mark"><MailCheck size={24} /></div>
    {email ? <>
      <p className="eyebrow">EMAIL VERIFIED</p>
      <h1>Your sign-in email changed</h1>
      <p className="muted">{email} is now verified. For your security, sign in again{platformHost ? ' to the platform control plane' : ' to your workspace'}.</p>
      <Link className="button button-primary auth-submit" href="/login">Continue to sign in <ArrowRight size={16} /></Link>
    </> : <>
      <p className="eyebrow">ACCOUNT SECURITY</p>
      <h1>Verify your new email</h1>
      {!ready || busy ? <p className="muted">Checking your verification link…</p> : !token ? <div className="notice notice-error" role="alert">This link is missing or expired. Sign in and request a new email verification.</div> : error ? <div className="notice notice-error" role="alert">{error}</div> : <div className="notice"><Check size={16} /> Verifying your new email address…</div>}
    </>}
  </section></main>;
}
