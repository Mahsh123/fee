'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Building2, LockKeyhole } from 'lucide-react';
import { ApiError, platformHomeHref, signIn } from '../../lib/api';
import { useSession } from '../../components/session-provider';
import { useTenant } from '../../components/tenant-provider';

export default function LoginPage() {
  const router = useRouter();
  const { update } = useSession();
  const tenant = useTenant();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const session = await signIn({ email: String(form.get('email')).trim(), password: String(form.get('password')) });
      update(session);
      router.replace(session.user.mustChangePassword ? '/change-password' : safeNextPath());
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'We could not sign you in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (tenant.kind === 'loading') return <div className="loading-page" role="status">Finding this workspace…</div>;
  if (tenant.kind === 'error') return <section className="login-card"><p className="eyebrow">INSTITUTION WORKSPACE</p><h1>Workspace information is unavailable</h1><p className="muted">We could not reach the workspace service. Check your connection and try again.</p><button className="button button-primary" onClick={() => window.location.reload()}>Try again</button></section>;
  if (tenant.kind === 'unknown' || tenant.kind === 'inactive') return <section className="login-card"><p className="eyebrow">INSTITUTION WORKSPACE</p><h1>{tenant.kind === 'inactive' ? 'Workspace temporarily unavailable' : 'Workspace not found'}</h1><p className="muted">{tenant.kind === 'inactive' ? 'This institution is not accepting sign-ins right now.' : 'Check the web address or contact your institution for the correct sign-in link.'}</p><a className="button button-secondary" href={platformHomeHref()}>Return home</a></section>;

  const title = tenant.kind === 'tenant' ? tenant.branding.organizationName : 'Fee Platform';

  return <section className="login-card" aria-labelledby="login-title">
    <Link href="/" className="login-back-link">← {title}</Link>
    <div className="login-icon"><LockKeyhole size={22} /></div>
    <p className="eyebrow">{tenant.kind === 'tenant' ? tenant.branding.organizationName : 'Platform administration'}</p>
    <h1 id="login-title">Welcome back</h1>
    <p className="muted">{tenant.kind === 'tenant' ? `Sign in to ${title} to manage students, fee schedules, and collections.` : 'Sign in to manage the Fee Platform.'}</p>
    <form className="form-stack login-form" onSubmit={submit}>
      <label>Email address<input name="email" type="email" autoComplete="username" placeholder="name@school.edu" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary button-wide" disabled={busy}>{busy ? 'Signing in…' : <>Sign in <ArrowRight size={16} /></>}</button>
    </form>
    <p className="login-footnote"><Building2 size={14} /> {tenant.kind === 'tenant' ? `Your account is scoped to ${title}.` : 'Platform administration is restricted to authorized operators.'}</p>
  </section>;
}

function safeNextPath(): string {
  const requested = new URLSearchParams(window.location.search).get('next');
  if (!requested) return '/';
  try {
    const destination = new URL(requested, window.location.origin);
    if (destination.origin !== window.location.origin || destination.pathname === '/login') return '/';
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return '/';
  }
}
