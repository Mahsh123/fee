'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Building2, Handshake, Plus } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api';
import { useSession } from '../../components/session-provider';

interface Sponsor { id: string; name: string; code: string; type: string; contactPerson: string | null; phone: string | null; email: string | null; address: string | null; creditLimit: string | null; active: boolean }
interface SponsorPage { items: Sponsor[]; pagination: { total: number } }

export default function SponsorsPage() {
  const { user } = useSession();
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingSponsor, setEditingSponsor] = useState<Sponsor | null>(null);
  const canRead = user?.permissions.includes('sponsor.read') ?? false;
  const canCreate = user?.permissions.includes('sponsor.create') ?? false;
  const canUpdate = user?.permissions.includes('sponsor.update') ?? false;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiRequest<SponsorPage>('/sponsors?pageSize=200&sort=name');
      setSponsors(result.items); setTotal(result.pagination.total); setError('');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Sponsor records could not be loaded.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (canRead) void load(); else setLoading(false); }, [canRead, load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const optional = (field: string) => String(values.get(field) ?? '').trim() || null;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest('/sponsors', { method: 'POST', body: JSON.stringify({
        name: String(values.get('name')).trim(), code: String(values.get('code')).trim(), type: String(values.get('type')).trim(),
        contactPerson: optional('contactPerson'), phone: optional('phone'), email: optional('email'), address: optional('address'),
        creditLimit: optional('creditLimit'),
      }) });
      form.reset(); setNotice('Sponsor added. It can now be recorded as a payment payer.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Sponsor could not be saved.'); }
    finally { setBusy(false); }
  }

  async function toggle(sponsor: Sponsor) {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/sponsors/${sponsor.id}`, { method: 'PATCH', body: JSON.stringify({ active: !sponsor.active }) });
      setNotice(`${sponsor.name} ${sponsor.active ? 'deactivated' : 'activated'}.`); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Sponsor status could not be changed.'); }
    finally { setBusy(false); }
  }

  async function updateSponsor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingSponsor) return;
    const values = new FormData(event.currentTarget);
    const optional = (field: string) => String(values.get(field) ?? '').trim() || null;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/sponsors/${editingSponsor.id}`, { method: 'PATCH', body: JSON.stringify({
        name: String(values.get('name')).trim(), code: String(values.get('code')).trim(), type: String(values.get('type')).trim(),
        contactPerson: optional('contactPerson'), phone: optional('phone'), email: optional('email'), address: optional('address'),
        creditLimit: optional('creditLimit'),
      }) });
      setNotice(`${editingSponsor.name} updated.`); setEditingSponsor(null); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Sponsor could not be updated.'); }
    finally { setBusy(false); }
  }

  if (!canRead) return <main id="main-content" className="page-content"><section className="empty-state"><span className="empty-icon"><Handshake /></span><h1>Sponsor access required</h1><p>Your role does not include access to sponsor records.</p></section></main>;

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">STUDENT / PAYER</p><h1>Sponsors</h1><p className="muted">Keep third-party payer details on the institution account and reference the sponsor on collected payments.</p></div><span className="heading-count"><Handshake size={16} /> {total} sponsors</span></div>
    {notice && <div className="notice notice-success" role="status">{notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    <div className="sponsor-layout">
      {canCreate && <section className="surface-panel sponsor-create-panel"><div className="section-heading section-heading-panel"><div><h2>Add sponsor</h2><p>Organisations, government programmes, trusts, and other payers.</p></div><Plus size={18} /></div>
        <form className="sponsor-form" onSubmit={save}>
          <label>Name<input name="name" required maxLength={160} /></label>
          <label>Code<input name="code" required maxLength={32} pattern="[A-Za-z0-9_-]+" placeholder="TRUST_01" /></label>
          <label>Type<input name="type" required maxLength={80} placeholder="Government programme" /></label>
          <label>Contact person<input name="contactPerson" maxLength={160} /></label>
          <label>Email<input name="email" type="email" maxLength={254} /></label>
          <label>Phone<input name="phone" maxLength={32} /></label>
          <label>Credit limit (optional)<input name="creditLimit" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,4})?" placeholder="0.00" /></label>
          <label className="sponsor-wide-field">Address<textarea name="address" rows={2} maxLength={1000} /></label>
          <button className="button button-primary sponsor-wide-field" disabled={busy}><Plus size={15} /> {busy ? 'Saving…' : 'Add sponsor'}</button>
        </form>
      </section>}
      {editingSponsor && canUpdate && <section className="surface-panel sponsor-create-panel"><div className="section-heading section-heading-panel"><div><h2>Edit sponsor</h2><p>Updates apply to future collections. Existing payments retain their payer snapshot.</p></div><button className="button button-secondary button-small" type="button" onClick={() => setEditingSponsor(null)}>Cancel</button></div>
        <form className="sponsor-form" onSubmit={updateSponsor}>
          <label>Name<input name="name" required maxLength={160} defaultValue={editingSponsor.name} /></label>
          <label>Code<input name="code" required maxLength={32} pattern="[A-Za-z0-9_-]+" defaultValue={editingSponsor.code} /></label>
          <label>Type<input name="type" required maxLength={80} defaultValue={editingSponsor.type} /></label>
          <label>Contact person<input name="contactPerson" maxLength={160} defaultValue={editingSponsor.contactPerson ?? ''} /></label>
          <label>Email<input name="email" type="email" maxLength={254} defaultValue={editingSponsor.email ?? ''} /></label>
          <label>Phone<input name="phone" maxLength={32} defaultValue={editingSponsor.phone ?? ''} /></label>
          <label>Credit limit (optional)<input name="creditLimit" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,4})?" defaultValue={editingSponsor.creditLimit ?? ''} /></label>
          <label className="sponsor-wide-field">Address<textarea name="address" rows={2} maxLength={1000} defaultValue={editingSponsor.address ?? ''} /></label>
          <button className="button button-primary sponsor-wide-field" disabled={busy}>{busy ? 'Saving…' : 'Save sponsor'}</button>
        </form>
      </section>}
      <section className="surface-panel sponsor-list-panel"><div className="section-heading section-heading-panel"><div><h2>Institution sponsors</h2><p>Contact details stay within this tenant.</p></div><Building2 size={18} /></div>
        {loading ? <div className="compact-empty">Loading sponsor records…</div> : sponsors.length ? <div className="table-wrap"><table><thead><tr><th>Sponsor</th><th>Type</th><th>Contact</th><th>Credit limit</th><th>Status</th>{canUpdate && <th></th>}</tr></thead><tbody>{sponsors.map((sponsor) => <tr key={sponsor.id}><td><strong>{sponsor.name}</strong><small className="table-subtext">{sponsor.code}</small></td><td>{sponsor.type}</td><td>{sponsor.contactPerson ?? '—'}<small className="table-subtext">{sponsor.email ?? sponsor.phone ?? ''}</small></td><td>{sponsor.creditLimit ?? '—'}</td><td><span className={`status-pill ${sponsor.active ? 'status-green' : 'status-gray'}`}>{sponsor.active ? 'Active' : 'Inactive'}</span></td>{canUpdate && <td><div className="button-row"><button className="button button-secondary button-small" disabled={busy} onClick={() => setEditingSponsor(sponsor)}>Edit</button><button className="button button-secondary button-small" disabled={busy} onClick={() => void toggle(sponsor)}>{sponsor.active ? 'Deactivate' : 'Activate'}</button></div></td>}</tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><Handshake /></span><h2>No sponsors configured</h2><p>Add a sponsor payer to record third-party collections.</p></div>}
      </section>
    </div>
  </main>;
}
