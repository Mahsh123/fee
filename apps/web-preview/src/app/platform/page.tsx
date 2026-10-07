'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Building2, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { TENANT_STATUSES, enumLabel } from '@fee/types';
import { ApiError, apiRequest } from '../../lib/api';
import { useSession } from '../../components/session-provider';

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: (typeof TENANT_STATUSES)[number];
  contactEmail: string | null;
  contactPhone: string | null;
  countryCode: string | null;
  trialEndsAt: string | null;
  createdAt: string;
}

interface TenantPage { items: TenantRow[]; pagination: { total: number } }

export default function PlatformAdministrationPage() {
  const { user } = useSession();
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadTenants = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiRequest<TenantPage>('/platform/tenants?pageSize=100&sort=-createdAt');
      setTenants(result.items);
      setTotal(result.pagination.total);
      setError('');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Institution records could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (user?.isPlatformAdmin) void loadTenants(); else setLoading(false); }, [loadTenants, user?.isPlatformAdmin]);

  async function createTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const values = new FormData(formElement);
    const optional = (key: string) => String(values.get(key) ?? '').trim() || null;
    setBusy(true); setError(''); setNotice('');
    try {
      const created = await apiRequest<{ name: string; slug: string; ownerEmail: string }>('/platform/tenants', {
        method: 'POST',
        body: JSON.stringify({
          name: String(values.get('name')).trim(),
          slug: String(values.get('slug')).trim().toLowerCase(),
          contactEmail: optional('contactEmail'),
          contactPhone: optional('contactPhone'),
          countryCode: optional('countryCode'),
          currency: String(values.get('currency')).trim().toUpperCase(),
          currencySymbol: String(values.get('currencySymbol')).trim(),
          currencyMinorUnits: Number(values.get('currencyMinorUnits')),
          timezone: String(values.get('timezone')).trim(),
          locale: String(values.get('locale')).trim(),
          ownerEmail: String(values.get('ownerEmail')).trim(),
          ownerFirstName: String(values.get('ownerFirstName')).trim(),
          ownerLastName: optional('ownerLastName'),
          ownerTemporaryPassword: String(values.get('ownerTemporaryPassword')),
        }),
      });
      formElement.reset();
      setNotice(`${created.name} is ready. Give ${created.ownerEmail} the temporary password securely; they must change it at first sign-in. The institution signs in with slug “${created.slug}”.`);
      await loadTenants();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The institution could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(tenant: TenantRow, status: TenantRow['status']) {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/platform/tenants/${tenant.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setNotice(`${tenant.name} is now ${enumLabel(status).toLowerCase()}.`);
      await loadTenants();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'The institution status could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  if (!user?.isPlatformAdmin) return <main id="main-content" className="page-content"><section className="empty-state"><span className="empty-icon"><ShieldCheck /></span><h1>Platform administrator access required</h1><p>This workspace is available only to platform operators.</p></section></main>;

  return <main id="main-content" className="page-content platform-page">
    <div className="page-heading"><div><p className="eyebrow">PLATFORM OPERATIONS</p><h1>Institution administration</h1><p className="muted">Provision isolated workspaces and manage their lifecycle.</p></div><button className="button button-secondary" onClick={() => void loadTenants()} disabled={loading || busy}><RefreshCw size={15} /> Refresh</button></div>
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    {notice && <div className="notice notice-success" role="status">{notice}</div>}

    <div className="platform-layout">
      <section className="surface-panel platform-create-panel">
        <div className="section-heading section-heading-panel"><div><h2>Provision an institution</h2><p>Creates the tenant owner, configurable roles, standard finance accounts, and collection methods in one transaction.</p></div><Plus size={18} /></div>
        <form className="platform-form" onSubmit={createTenant}>
          <h3>Institution</h3>
          <div className="platform-form-grid">
            <label>Organization name<input name="name" required minLength={2} maxLength={160} autoComplete="organization" /></label>
            <label>Sign-in slug<input name="slug" required minLength={2} maxLength={64} pattern="[a-z0-9][a-z0-9-]*" placeholder="north-campus" /><small>Lowercase letters, numbers, and hyphens.</small></label>
            <label>Contact email<input name="contactEmail" type="email" /></label>
            <label>Contact phone<input name="contactPhone" maxLength={32} /></label>
            <label>Country code<input name="countryCode" minLength={2} maxLength={2} placeholder="IN" /></label>
          </div>
          <h3>Regional settings</h3>
          <div className="platform-form-grid">
            <label>Currency code<input name="currency" required defaultValue="INR" minLength={3} maxLength={3} /></label>
            <label>Currency symbol<input name="currencySymbol" required defaultValue="₹" maxLength={8} /></label>
            <label>Minor currency units<input name="currencyMinorUnits" type="number" required defaultValue={2} min={0} max={4} /></label>
            <label>Time zone<input name="timezone" required defaultValue="Asia/Kolkata" maxLength={100} /></label>
            <label>Locale<input name="locale" required defaultValue="en-IN" maxLength={32} /></label>
          </div>
          <h3>Institution owner</h3>
          <div className="platform-form-grid">
            <label>Owner first name<input name="ownerFirstName" required maxLength={120} autoComplete="given-name" /></label>
            <label>Owner last name<input name="ownerLastName" maxLength={120} autoComplete="family-name" /></label>
            <label>Owner email<input name="ownerEmail" type="email" required maxLength={254} autoComplete="email" /></label>
            <label>Temporary password<input name="ownerTemporaryPassword" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /><small>At least 12 characters; the owner must replace it after sign-in.</small></label>
          </div>
          <button className="button button-primary" disabled={busy}><Plus size={15} /> {busy ? 'Provisioning…' : 'Create institution'}</button>
        </form>
      </section>

      <section className="surface-panel platform-directory-panel">
        <div className="section-heading section-heading-panel"><div><h2>Institutions</h2><p>{total.toLocaleString()} tenant{total === 1 ? '' : 's'} on this platform{total > tenants.length ? ` · showing ${tenants.length}` : ''}</p></div><Building2 size={18} /></div>
        {loading ? <div className="compact-empty">Loading institution records…</div> : tenants.length ? <div className="platform-tenant-list">{tenants.map((tenant) => <article className="platform-tenant-card" key={tenant.id}>
          <div className="platform-tenant-heading"><div><strong>{tenant.name}</strong><small>{tenant.slug}</small></div><span className={`status-pill ${tenant.status === 'ACTIVE' ? 'status-green' : tenant.status === 'SUSPENDED' || tenant.status === 'ARCHIVED' ? 'status-red' : 'status-amber'}`}>{enumLabel(tenant.status)}</span></div>
          <p>{tenant.contactEmail ?? 'No contact email'}{tenant.countryCode ? ` · ${tenant.countryCode}` : ''}</p>
          <small>Created {new Date(tenant.createdAt).toLocaleDateString()}</small>
          <div className="platform-tenant-actions">
            {tenant.status !== 'ACTIVE' && <button className="button button-secondary button-small" disabled={busy} onClick={() => void setStatus(tenant, 'ACTIVE')}>Activate</button>}
            {tenant.status === 'ACTIVE' && <button className="button button-secondary button-small" disabled={busy} onClick={() => void setStatus(tenant, 'SUSPENDED')}>Suspend</button>}
            {tenant.status !== 'ARCHIVED' && <button className="text-button platform-archive-action" disabled={busy} onClick={() => void setStatus(tenant, 'ARCHIVED')}>Archive</button>}
          </div>
        </article>)}</div> : <div className="empty-state"><span className="empty-icon"><Building2 /></span><h3>No institutions yet</h3><p>Create the first tenant workspace using the form.</p></div>}
      </section>
    </div>
  </main>;
}
