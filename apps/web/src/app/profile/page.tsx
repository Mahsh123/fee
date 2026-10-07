'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Check, CircleUserRound, Save } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api';
import { readSession } from '../../lib/api';
import { useSession } from '../../components/session-provider';

interface Profile { id: string; email: string; pendingEmail: string | null; emailVerifiedAt: string | null; phone: string | null; firstName: string; lastName: string | null }

export default function ProfilePage() {
  const { user, update } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void apiRequest<Profile>('/auth/me').then((result) => { if (active) setProfile(result); })
      .catch((cause) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Your profile could not be loaded.'); });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!profile) return;
    setBusy(true); setError(''); setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      const saved = await apiRequest<Profile>('/auth/me', { method: 'PATCH', body: JSON.stringify({
        firstName: form.get('firstName'), lastName: form.get('lastName') || null, phone: form.get('phone') || null,
      }) });
      setProfile(saved);
      const session = readSession();
      if (session) update({ ...session, user: { ...session.user, ...saved } });
      setNotice('Your profile has been updated.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Your profile could not be saved.'); }
    finally { setBusy(false); }
  }

  async function requestEmailChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!profile) return;
    const formElement = event.currentTarget;
    setBusy(true); setError(''); setNotice('');
    const form = new FormData(formElement);
    try {
      const result = await apiRequest<{ pendingEmail: string; expiresAt: string }>('/auth/me/email-change', { method: 'POST', body: JSON.stringify({
        email: form.get('email'), currentPassword: form.get('currentPassword'),
      }) });
      setProfile({ ...profile, pendingEmail: result.pendingEmail });
      formElement.reset();
      setNotice(`A verification link was sent to ${result.pendingEmail}. Your current address stays active until the link is used.`);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The email verification could not be requested.'); }
    finally { setBusy(false); }
  }

  const current = profile ?? (user ? { id: user.id, email: user.email, phone: user.phone ?? null, firstName: user.firstName, lastName: user.lastName } : null);
  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">ACCOUNT</p><h1>My profile</h1><p className="muted">Update the name and contact number shown to your organization.</p></div></div>
    {notice && <div className="notice notice-success" role="status"><Check size={16} /> {notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    <section className="surface-panel profile-settings-panel"><div className="section-heading section-heading-panel"><div><h2>Profile details</h2><p>Update the name and contact number shown to your organization.</p></div><CircleUserRound size={18} /></div>
      {current && <form className="profile-settings-form" onSubmit={(event) => void save(event)}><label>First name<input name="firstName" required maxLength={120} defaultValue={current.firstName} key={`${current.id}-${current.firstName}`} /></label><label>Last name<input name="lastName" maxLength={120} defaultValue={current.lastName ?? ''} key={`${current.id}-${current.lastName}`} /></label><label>Email<input type="email" value={current.email} readOnly aria-readonly="true" /></label><label>Phone<input name="phone" maxLength={32} defaultValue={current.phone ?? ''} key={`${current.id}-${current.phone}`} /></label><div className="profile-settings-actions"><span className="muted">Signed in as {current.email}</span><button className="button button-primary" disabled={busy}><Save size={15} /> {busy ? 'Saving…' : 'Save profile'}</button></div></form>}
    </section>
    {current && <section className="surface-panel profile-settings-panel"><div className="section-heading section-heading-panel"><div><h2>Sign-in email</h2><p>We verify the new address before changing where you sign in.</p></div></div>{profile?.pendingEmail && <p className="notice">Verification is pending for {profile.pendingEmail}. The link expires 30 minutes after it was sent.</p>}<form className="profile-settings-form" onSubmit={(event) => void requestEmailChange(event)}><label>New email address<input name="email" type="email" autoComplete="email" required maxLength={254} /></label><label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required /></label><div className="profile-settings-actions"><span className="muted">A successful change signs out other sessions.</span><button className="button button-secondary" disabled={busy}>{busy ? 'Sending…' : 'Send verification link'}</button></div></form></section>}
  </main>;
}
