'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, CircleUserRound, Save } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api';
import { formatIndianDateTime } from '../../lib/locale';
import { readSession } from '../../lib/api';
import { useSession } from '../../components/session-provider';

interface Profile { id: string; email: string; pendingEmail: string | null; emailVerifiedAt: string | null; phone: string | null; firstName: string; lastName: string | null; mfaEnabled?: boolean }
interface SessionRow { id: string; userAgent: string | null; ipAddress: string | null; createdAt: string; expiresAt: string; revokedAt: string | null }
interface Enrollment { secret: string; otpauthUrl: string }

export default function ProfilePage() {
  const { user, update } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  const loadSessions = useCallback(async () => {
    try { setSessions(await apiRequest<SessionRow[]>('/auth/me/sessions')); }
    catch { setSessions([]); }
  }, []);

  useEffect(() => {
    let active = true;
    void apiRequest<Profile>('/auth/me').then((result) => { if (active) setProfile(result); })
      .catch((cause) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Your profile could not be loaded.'); });
    void loadSessions();
    return () => { active = false; };
  }, [loadSessions]);

  async function beginMfaEnrollment() {
    setBusy(true); setError(''); setNotice('');
    try {
      setEnrollment(await apiRequest<Enrollment>('/auth/me/mfa/enroll', { method: 'POST' }));
      setRecoveryCodes([]);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Authenticator setup could not be started.'); }
    finally { setBusy(false); }
  }

  async function activateMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      const result = await apiRequest<{ recoveryCodes: string[] }>('/auth/me/mfa/activate', { method: 'POST', body: JSON.stringify({ code: String(form.get('code') ?? '').trim() }) });
      setRecoveryCodes(result.recoveryCodes);
      setEnrollment(null);
      setProfile((current) => current ? { ...current, mfaEnabled: true } : current);
      setNotice('Two-factor sign-in is active. Store the recovery codes somewhere safe; they are shown once.');
      await loadSessions();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'That code could not be confirmed.'); }
    finally { setBusy(false); }
  }

  async function disableMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      await apiRequest('/auth/me/mfa/disable', { method: 'POST', body: JSON.stringify({ password: String(values.get('password') ?? '') }) });
      form.reset();
      setRecoveryCodes([]);
      setProfile((current) => current ? { ...current, mfaEnabled: false } : current);
      setNotice('Two-factor sign-in is now off for your account.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Two-factor sign-in could not be turned off.'); }
    finally { setBusy(false); }
  }

  async function revokeSession(sessionId: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/auth/me/sessions/${sessionId}`, { method: 'DELETE' });
      setNotice('That session was signed out.');
      await loadSessions();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The session could not be revoked.'); }
    finally { setBusy(false); }
  }

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
    <section className="surface-panel profile-settings-panel">
      <div className="section-heading section-heading-panel"><div><h2>Two-factor sign-in</h2><p>An authenticator code is required every time you sign in{user?.isPlatformAdmin ? ', and platform operators should keep it on' : ''}.</p></div></div>
      {user?.mfaSetupRequired && !profile?.mfaEnabled && <p className="notice">Your platform operator account does not have an authenticator yet. Enrol one to protect control-plane access.</p>}
      {recoveryCodes.length > 0 && <div className="notice"><div><strong>Recovery codes</strong><p className="muted">Each code works once. Store them offline; they cannot be shown again.</p><div className="recovery-codes">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div></div></div>}
      {enrollment ? <form className="profile-settings-form" onSubmit={(event) => void activateMfa(event)}>
        <p className="muted">Add this secret to your authenticator app, then enter the 6-digit code it shows.</p>
        <label>Secret key<input value={enrollment.secret} readOnly aria-readonly="true" /></label>
        <label>Setup link<input value={enrollment.otpauthUrl} readOnly aria-readonly="true" /></label>
        <label>Authenticator code<input name="code" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required autoComplete="one-time-code" /></label>
        <div className="profile-settings-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => setEnrollment(null)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Confirming…' : 'Activate two-factor sign-in'}</button></div>
      </form> : profile?.mfaEnabled ? <form className="profile-settings-form" onSubmit={(event) => void disableMfa(event)}>
        <p className="muted">Two-factor sign-in is active for {profile.email}.</p>
        <label>Current password<input name="password" type="password" autoComplete="current-password" required /></label>
        <div className="profile-settings-actions"><button className="button button-secondary" disabled={busy}>{busy ? 'Turning off…' : 'Turn off two-factor sign-in'}</button></div>
      </form> : <div className="profile-settings-actions"><span className="muted">Not enabled</span><button className="button button-primary" disabled={busy} onClick={() => void beginMfaEnrollment()}>Set up authenticator</button></div>}
    </section>

    <section className="surface-panel profile-settings-panel">
      <div className="section-heading section-heading-panel"><div><h2>Active sessions</h2><p>Signing a session out takes effect the next time that device refreshes its access.</p></div></div>
      {sessions.length ? <div className="table-wrap"><table><thead><tr><th>Started</th><th>Device</th><th>Expires</th><th></th></tr></thead><tbody>{sessions.map((session) => <tr key={session.id}><td>{formatIndianDateTime(new Date(session.createdAt))}</td><td>{session.userAgent ?? 'Unknown device'}<small className="table-subtext">{session.ipAddress ?? 'No address recorded'}</small></td><td>{session.revokedAt ? <span className="status-pill status-gray">Signed out</span> : formatIndianDateTime(new Date(session.expiresAt))}</td><td>{!session.revokedAt && <button className="button button-secondary button-small" disabled={busy} onClick={() => void revokeSession(session.id)}>Sign out</button>}</td></tr>)}</tbody></table></div> : <p className="empty-inline">No sessions recorded yet.</p>}
    </section>
  </main>;
}
