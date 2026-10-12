'use client';
import { formatIndianDateTime } from '../../lib/locale';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { NOTIFICATION_CHANNELS, NOTIFICATION_EVENTS, enumLabel } from '@fee/types';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { useSession } from '../../components/session-provider';
import { BellRing, Check } from 'lucide-react';

interface Template { id: string; event: string; channel: string; locale: string; subject: string | null; body: string; variables: string[]; active: boolean }
interface HistoryRow { id: string; event: string; channel: string; status: string; recipientType: string; toAddress: string; subject: string | null; attemptCount: number; lastError: string | null; sentAt: string | null; createdAt: string }

export default function NotificationsPage() {
  const { user } = useSession();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canRead = hasPermission(user, 'tenant.settings.read');
  const canEdit = hasPermission(user, 'tenant.settings.update');

  const load = useCallback(async () => {
    if (!canRead) return;
    try {
      const [templateRows, historyRows] = await Promise.all([
        apiRequest<Template[]>('/notifications/templates'),
        apiRequest<HistoryRow[]>('/notifications/history'),
      ]);
      setTemplates(templateRows); setHistory(historyRows); setError('');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Notification records could not be loaded.'); }
  }, [canRead]);
  useEffect(() => { void load(); }, [load]);

  const selected = templates.find((template) => template.id === selectedId);
  useEffect(() => {
    const form = document.querySelector<HTMLFormElement>('#notification-template-form');
    if (!form) return;
    const values = selected;
    (form.elements.namedItem('event') as HTMLSelectElement).value = values?.event ?? 'PAYMENT_SUCCESS';
    (form.elements.namedItem('channel') as HTMLSelectElement).value = values?.channel ?? 'EMAIL';
    (form.elements.namedItem('locale') as HTMLInputElement).value = values?.locale ?? 'en';
    (form.elements.namedItem('subject') as HTMLInputElement).value = values?.subject ?? '';
    (form.elements.namedItem('body') as HTMLTextAreaElement).value = values?.body ?? '';
    (form.elements.namedItem('variables') as HTMLInputElement).value = values?.variables.join(', ') ?? '';
    (form.elements.namedItem('active') as HTMLInputElement).checked = values?.active ?? true;
  }, [selected]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<Template>('/notifications/templates', { method: 'POST', body: JSON.stringify({
        event: values.get('event'), channel: values.get('channel'), locale: values.get('locale'), subject: values.get('subject') || null,
        body: values.get('body'), variables: String(values.get('variables') ?? '').split(',').map((value) => value.trim()).filter(Boolean), active: values.get('active') === 'on',
      }) });
      setNotice(`Template ${enumLabel(result.event)} · ${enumLabel(result.channel)} saved.`); await load(); setSelectedId(result.id);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Notification template could not be saved.'); }
    finally { setBusy(false); }
  }

  if (!canRead) return <main id="main-content" className="page-content"><div className="page-heading"><div><p className="eyebrow">TENANT SETTINGS</p><h1>Notifications</h1></div></div><div className="notice notice-error" role="alert">Your role needs tenant settings read access to view notification records.</div></main>;

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">TENANT SETTINGS</p><h1>Notifications</h1><p className="muted">Configure tenant event messages and review queued, sent, and failed notifications.</p></div><span className="heading-count"><BellRing size={16} /> {history.length} recent attempts</span></div>
    {notice && <div className="notice notice-success" role="status"><Check size={16} /> {notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    <div className="notification-layout">
      {canEdit && <section className="surface-panel notification-template-panel"><div className="section-heading section-heading-panel"><div><h2>{selected ? 'Edit template' : 'Add a template'}</h2><p>Templates are rendered from transaction events using only supplied values.</p></div></div>
        <label className="notification-picker">Existing template<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Create a new template</option>{templates.map((template) => <option key={template.id} value={template.id}>{enumLabel(template.event)} · {enumLabel(template.channel)} · {template.locale}</option>)}</select></label>
        <form id="notification-template-form" className="notification-form" onSubmit={save}>
          <label>Event<select name="event">{NOTIFICATION_EVENTS.map((event) => <option key={event} value={event}>{enumLabel(event)}</option>)}</select></label>
          <label>Channel<select name="channel">{NOTIFICATION_CHANNELS.filter((channel) => channel === 'EMAIL').map((channel) => <option key={channel} value={channel}>{enumLabel(channel)}</option>)}</select></label>
          <label>Locale<input name="locale" required maxLength={12} defaultValue="en" /></label>
          <label>Subject<input name="subject" maxLength={300} placeholder="{{tenant.name}} payment receipt" /></label>
          <label className="notification-body-field">Message body<textarea name="body" required rows={8} maxLength={10000} placeholder={'Hello {{student.fullName}}, payment {{payment.paymentNumber}} was received.'} /></label>
          <label>Template variables<input name="variables" placeholder="student.fullName, payment.paymentNumber" /><small>Comma-separated variable names available in this message.</small></label>
          <label className="check-label"><input name="active" type="checkbox" defaultChecked /> Active</label>
          <div className="notification-form-footer"><span className="muted">Email delivery is queued after a matching tenant event.</span><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save template'}</button></div>
        </form>
      </section>}
      <section className="surface-panel notification-history-panel"><div className="section-heading section-heading-panel"><div><h2>Delivery history</h2><p>Recipient details are visible only to institution settings administrators.</p></div></div>{history.length ? <div className="table-wrap"><table><thead><tr><th>Event</th><th>Recipient</th><th>Subject</th><th>Created</th><th>Attempts</th><th>Status</th></tr></thead><tbody>{history.map((row) => <tr key={row.id}><td>{enumLabel(row.event)}<small className="table-subtext">{enumLabel(row.channel)}</small></td><td>{row.toAddress}<small className="table-subtext">{row.recipientType}</small></td><td>{row.subject ?? '—'}{row.lastError && <small className="table-subtext">{row.lastError}</small>}</td><td>{formatIndianDateTime(new Date(row.createdAt))}</td><td>{row.attemptCount}</td><td><span className={`status-pill ${row.status === 'SENT' || row.status === 'DELIVERED' ? 'status-green' : row.status === 'FAILED' ? 'status-red' : 'status-amber'}`}>{row.status}</span></td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><BellRing /></span><h2>No notification attempts</h2><p>Configure a template to send event-driven tenant messages.</p></div>}</section>
    </div>
  </main>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }
