'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, apiRequest, signOut } from '../../lib/api';
import { useSession } from '../../components/session-provider';
import { KeyRound, LockKeyhole } from 'lucide-react';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user } = useSession();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const form = new FormData(event.currentTarget);
    const currentPassword = String(form.get('currentPassword') ?? '');
    const newPassword = String(form.get('newPassword') ?? '');
    if (newPassword !== String(form.get('confirmPassword') ?? '')) { setError('The new passwords do not match.'); return; }
    setBusy(true);
    try {
      await apiRequest('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
      await signOut();
      router.replace('/login');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The password could not be changed. Please try again.'); }
    finally { setBusy(false); }
  }

  return <main id="main-content" className="page-content password-change-page">
    <section className="surface-panel password-change-card">
      <span className="empty-icon"><KeyRound /></span><p className="eyebrow">ACCOUNT SECURITY</p><h1>Set a new password</h1>
      <p className="muted">{user?.mustChangePassword ? 'Your temporary password must be replaced before opening the workspace.' : 'Changing your password ends the other active refresh sessions for this account.'}</p>
      <form className="form-stack" onSubmit={submit}>
        <label>Current password<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
        <label>New password<input name="newPassword" type="password" autoComplete="new-password" minLength={12} required /><small>Use at least 12 characters.</small></label>
        <label>Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button button-primary button-wide" disabled={busy}><LockKeyhole size={16} /> {busy ? 'Updating password…' : 'Update password'}</button>
      </form>
    </section>
  </main>;
}
