'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, MailPlus, ShieldCheck } from 'lucide-react';
import { ApiError, apiRequest, platformHomeHref } from '../../lib/api';
import { useTenant } from '../../components/tenant-provider';

export default function RegisterPage() {
  const tenant = useTenant();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  if (tenant.kind === 'loading') return <main id="main-content" className="loading-page" role="status">Finding this workspace…</main>;
  if (tenant.kind === 'error') return <main id="main-content" className="auth-page"><section className="auth-card"><h1>Workspace information is unavailable</h1><p className="muted">We could not load this organization. Check your connection and try again.</p><button className="button button-primary" onClick={() => window.location.reload()}>Try again</button></section></main>;
  if (tenant.kind === 'unknown') return <main id="main-content" className="auth-page"><section className="auth-card"><p className="eyebrow">WORKSPACE REGISTRATION</p><h1>Workspace not found</h1><p className="muted">Check the organization link you were given, or return to the platform home.</p><a className="button button-secondary" href={platformHomeHref()}>Platform home</a></section></main>;
  if (tenant.kind === 'inactive') return <main id="main-content" className="auth-page"><section className="auth-card"><p className="eyebrow">{tenant.name}</p><h1>Registration is unavailable</h1><p className="muted">This organization is not accepting account requests right now. Contact its administrator for help.</p></section></main>;
  if (tenant.kind === 'platform') return <main id="main-content" className="auth-page"><section className="auth-card"><p className="eyebrow">PLATFORM ACCESS</p><h1>Organization accounts are created by invitation</h1><p className="muted">A platform administrator must provision an organization workspace and invite its first administrator.</p><Link className="button button-secondary" href="/login">Platform sign in <ArrowRight size={16} /></Link></section></main>;

  const organizationName = tenant.branding.organizationName || tenant.name;
  const subject = encodeURIComponent(`Workspace access request for ${organizationName}`);
  const body = encodeURIComponent(`Hello ${organizationName} team,\n\nI would like an invitation to join your organization workspace.\n\nThank you.`);
  const contactHref = tenant.branding.email ? `mailto:${encodeURIComponent(tenant.branding.email)}?subject=${subject}&body=${body}` : null;

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await apiRequest<{ submitted: true }>('/auth/register', { method: 'POST', body: JSON.stringify(form) });
      setSubmitted(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Your registration could not be submitted. Try again or contact the organization administrator.');
    } finally {
      setBusy(false);
    }
  }

  if (tenant.allowPublicRegistration) return <main id="main-content" className="auth-page">
    <section className="auth-card" aria-labelledby="registration-title">
      <Link href="/" className="login-back-link"><ArrowLeft size={15} /> {organizationName}</Link>
      <div className="login-icon"><MailPlus size={22} /></div>
      <p className="eyebrow">JOIN {organizationName.toUpperCase()}</p>
      {submitted ? <>
        <h1 id="registration-title">Check your email</h1>
        <p className="muted">If this address can be registered, we’ll send a secure, time-limited invitation to finish setting up your account. If you already have an account, sign in instead.</p>
        <Link className="button button-primary auth-submit" href="/login">Continue to sign in <ArrowRight size={16} /></Link>
      </> : <>
        <h1 id="registration-title">Create your workspace account</h1>
        <p className="muted">We’ll email you a secure link to verify your address and choose a password. Your account will start with basic member access.</p>
        {error && <div className="notice notice-error" role="alert">{error}</div>}
        <form className="form-stack login-form" onSubmit={register}>
          <label>First name<input autoComplete="given-name" required maxLength={120} value={form.firstName} onChange={(event) => setForm({ ...form, firstName: event.target.value })} /></label>
          <label>Last name <span className="muted">(optional)</span><input autoComplete="family-name" maxLength={120} value={form.lastName} onChange={(event) => setForm({ ...form, lastName: event.target.value })} /></label>
          <label>Email address<input type="email" autoComplete="email" required maxLength={254} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Sending…' : 'Send verification link'} <ArrowRight size={16} /></button>
        </form>
      </>}
      <p className="login-registration-link">Already have an account? <Link href="/login">Sign in</Link></p>
      <p className="login-footnote"><ShieldCheck size={14} /> Your account will belong only to {organizationName}.</p>
    </section>
  </main>;

  return <main id="main-content" className="auth-page">
    <section className="auth-card" aria-labelledby="registration-title">
      <Link href="/" className="login-back-link"><ArrowLeft size={15} /> {organizationName}</Link>
      <div className="login-icon"><MailPlus size={22} /></div>
      <p className="eyebrow">JOIN {organizationName.toUpperCase()}</p>
      <h1 id="registration-title">Request workspace access</h1>
      <p className="muted">To protect {organizationName}’s private information, accounts are created by invitation from its administrator.</p>
      <div className="registration-guidance">
        <ShieldCheck size={18} />
        <p>Ask your organization administrator to invite your email address. When the invitation arrives, open its secure link to finish registration and set your password.</p>
      </div>
      {contactHref ? <a className="button button-primary auth-submit" href={contactHref}>Request an invitation <ArrowRight size={16} /></a> : <p className="notice notice-info">This organization has not published a contact email. Ask its administrator directly for an invitation.</p>}
      <p className="login-registration-link">Already have an account? <Link href="/login">Sign in</Link></p>
      <p className="login-footnote"><ShieldCheck size={14} /> Your account will belong only to {organizationName}.</p>
    </section>
  </main>;
}
