'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, CheckCircle2, Eye, EyeOff, KeyRound, MailCheck, ShieldCheck } from 'lucide-react';
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
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const invitationFragmentCaptured = useRef(false);

  useEffect(() => {
    if (invitationFragmentCaptured.current) return;
    invitationFragmentCaptured.current = true;
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

  const workspaceName = tenant.kind === 'tenant' ? tenant.branding.organizationName : 'Wasl platform';
  const supportsInvitations = tenant.kind === 'tenant' || platformHost;

  return <main id="main-content" className="auth-page invitation-page">
    <section className="invitation-card" aria-labelledby="invitation-title">
      <header className="invitation-brand-row">
        <Link className="invitation-wasl-brand" href="/" aria-label="Wasl home">
          <span className="invitation-wasl-mark" aria-hidden="true">W</span>
          <span>Wasl <span lang="ar" dir="rtl">وصل</span></span>
        </Link>
        <span className="invitation-brand-divider" aria-hidden="true" />
        <span className="invitation-workspace-name" title={workspaceName}>{workspaceName}</span>
      </header>

      {accepted ? <div className="invitation-success">
        <div className="invitation-icon invitation-icon-success"><CheckCircle2 size={25} /></div>
        <p className="eyebrow">INVITATION ACCEPTED</p>
        <h1 id="invitation-title">Your account is ready</h1>
        <p className="invitation-description">Your email is verified. Sign in to {platformHost ? 'the Wasl platform' : workspaceName} with the password you just created.</p>
        <Link className="button button-primary invitation-submit" href="/login">Continue to sign in <ArrowRight size={17} /></Link>
      </div> : <>
        <div className="invitation-intro">
          <div className="invitation-icon"><MailCheck size={24} /></div>
          <p className="eyebrow">SECURE ACCOUNT ACTIVATION</p>
          <h1 id="invitation-title">Set your password</h1>
          <p className="invitation-description">Activate your {platformHost ? 'Wasl platform administrator' : `${workspaceName} workspace`} account to get started.</p>
        </div>

        {error && <div className="notice notice-error invitation-error" role="alert">{error}</div>}
        {!ready ? <p className="invitation-status" role="status">Checking your secure invitation…</p>
          : !supportsInvitations ? <div className="notice notice-error invitation-error" role="alert">This workspace is unavailable. Open the invitation on the organization’s own link or ask its administrator to resend it.</div>
            : !token ? <div className="notice notice-error invitation-error" role="alert">This invitation link is missing or expired. Ask your {platformHost ? 'platform' : 'organization'} administrator to send a new one.</div>
              : <form className="invitation-form" onSubmit={accept} aria-busy={busy}>
                <label className="invitation-field" htmlFor="password">New password
                  <span className="invitation-input-shell"><KeyRound size={17} aria-hidden="true" /><input id="password" name="password" type={showPassword ? 'text' : 'password'} minLength={12} maxLength={200} autoComplete="new-password" aria-describedby="password-help" required />
                    <button type="button" className="invitation-visibility" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                  </span>
                </label>
                <p className="invitation-hint" id="password-help">Use at least 12 characters. A longer passphrase is easier to remember.</p>
                <label className="invitation-field" htmlFor="confirmPassword">Confirm password
                  <span className="invitation-input-shell"><Check size={17} aria-hidden="true" /><input id="confirmPassword" name="confirmPassword" type={showConfirmPassword ? 'text' : 'password'} minLength={12} maxLength={200} autoComplete="new-password" required />
                    <button type="button" className="invitation-visibility" onClick={() => setShowConfirmPassword((visible) => !visible)} aria-label={showConfirmPassword ? 'Hide confirmation' : 'Show confirmation'}>{showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                  </span>
                </label>
                <button className="button button-primary invitation-submit" disabled={busy}>{busy ? 'Activating your account…' : 'Accept invitation'} <ArrowRight size={17} /></button>
              </form>}

        <footer className="invitation-security-note"><ShieldCheck size={16} /><span>This secure link can be used once and expires automatically.</span></footer>
      </>}
    </section>
  </main>;
}
