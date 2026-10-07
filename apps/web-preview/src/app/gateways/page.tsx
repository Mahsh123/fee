'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { GATEWAY_ENVIRONMENTS, GATEWAY_PROVIDERS, PAYMENT_METHOD_KINDS, enumLabel } from '@fee/types';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { useSession } from '../../components/session-provider';
import { Check, Copy, ShieldCheck } from 'lucide-react';

interface Gateway { id: string; provider: string; environment: string; displayName: string; keyIdMasked: string | null; hasWebhookSecret: boolean; enabled: boolean; active: boolean; isDefault: boolean; isBackup: boolean; priority: number; supportedMethods: string[]; minAmount: string | null; maxAmount: string | null; updatedAt: string }

export default function GatewaysPage() {
  const { user } = useSession();
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState('');
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const canRead = hasPermission(user, 'tenant.settings.read');
  const canEdit = hasPermission(user, 'tenant.settings.update');

  const load = useCallback(async () => {
    if (!canRead) return;
    try { setGateways(await apiRequest<Gateway[]>('/gateways')); setError(''); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Gateway settings could not be loaded.'); }
  }, [canRead]);
  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); const methods = values.getAll('supportedMethods').map(String); setBusy('create'); setError(''); setNotice('');
    let extraConfig: Record<string, string> | undefined;
    const configText = String(values.get('extraConfig') ?? '').trim();
    try { if (configText) extraConfig = JSON.parse(configText) as Record<string, string>; }
    catch { setError('Provider settings must be valid JSON.'); setBusy(''); return; }
    try {
      await apiRequest('/gateways', { method: 'POST', body: JSON.stringify({ provider: values.get('provider'), environment: values.get('environment'), displayName: values.get('displayName'), keyId: values.get('keyId'), secret: values.get('secret'), webhookSecret: values.get('webhookSecret') || undefined, enabled: values.get('enabled') === 'on', isDefault: values.get('isDefault') === 'on', isBackup: values.get('isBackup') === 'on', priority: Number(values.get('priority') || 100), supportedMethods: methods, minAmount: values.get('minAmount') || undefined, maxAmount: values.get('maxAmount') || undefined, extraConfig }) });
      setNotice('Gateway credentials were encrypted and saved. Secret values are not returned by the API.'); form.reset(); setSelectedMethods([]); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Gateway configuration could not be saved.'); }
    finally { setBusy(''); }
  }

  async function update(id: string, patch: Partial<Pick<Gateway, 'enabled' | 'active' | 'isDefault'>>) {
    setBusy(id); setError(''); setNotice('');
    try { await apiRequest(`/gateways/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }); setNotice('Gateway configuration updated.'); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Gateway configuration could not be updated.'); }
    finally { setBusy(''); }
  }

  async function copyWebhook(configId: string) {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';
    const path = `${apiBase}/webhooks/${user?.tenantSlug}/${configId}`;
    await navigator.clipboard.writeText(path); setCopied(configId); window.setTimeout(() => setCopied(''), 1800);
  }

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">TENANT SETTINGS</p><h1>Payment gateways</h1><p className="muted">Configure encrypted provider credentials, supported instruments, and gateway routing.</p></div><span className="heading-count"><ShieldCheck size={16} /> {gateways.length} configurations</span></div>
    {notice && <div className="notice notice-success" role="status"><Check size={16} /> {notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    {!canRead && <div className="notice notice-error" role="alert">Your role needs tenant settings read access to view gateway configuration.</div>}
    <div className="gateway-layout">
      {canEdit && <section className="surface-panel gateway-create-panel"><div className="section-heading section-heading-panel"><div><h2>Add a gateway</h2><p>Provider secrets are encrypted before storage and are never displayed again.</p></div></div>
        <form className="gateway-form" onSubmit={save}>
          <label>Provider<select name="provider">{GATEWAY_PROVIDERS.map((provider) => <option key={provider} value={provider}>{enumLabel(provider)}</option>)}</select></label>
          <label>Environment<select name="environment">{GATEWAY_ENVIRONMENTS.map((environment) => <option key={environment} value={environment}>{enumLabel(environment)}</option>)}</select></label>
          <label>Display name<input name="displayName" required maxLength={120} placeholder="Primary online collection" /></label>
          <label>Key ID<input name="keyId" required maxLength={300} autoComplete="off" /></label>
          <label>Secret key<input name="secret" required type="password" maxLength={2000} autoComplete="new-password" /></label>
          <label>Webhook signing secret<input name="webhookSecret" type="password" maxLength={2000} autoComplete="new-password" /></label>
          <fieldset className="gateway-methods"><legend>Supported online methods</legend>{PAYMENT_METHOD_KINDS.filter((kind) => !['CASH', 'CHEQUE', 'DD', 'CARD_OFFLINE', 'UPI_MANUAL', 'BANK_TRANSFER'].includes(kind)).map((kind) => <label key={kind} className="check-label"><input type="checkbox" name="supportedMethods" value={kind} checked={selectedMethods.includes(kind)} onChange={() => setSelectedMethods((current) => current.includes(kind) ? current.filter((value) => value !== kind) : [...current, kind])} />{enumLabel(kind)}</label>)}</fieldset>
          <label>Minimum amount<input name="minAmount" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,4})?" /></label>
          <label>Maximum amount<input name="maxAmount" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,4})?" /></label>
          <label>Priority<input name="priority" type="number" min="0" max="100000" defaultValue="100" /></label>
          <label className="gateway-json-field">Provider options <small>JSON, for non-secret options such as HTTPS return URLs.</small><textarea name="extraConfig" rows={3} placeholder={'{"successUrl":"https://…","failureUrl":"https://…"}'} /></label>
          <div className="gateway-toggles"><label className="check-label"><input type="checkbox" name="enabled" /> Enabled</label><label className="check-label"><input type="checkbox" name="isDefault" /> Default route</label><label className="check-label"><input type="checkbox" name="isBackup" /> Backup route</label></div>
          <div className="gateway-submit"><span className="muted">Webhook URL is generated from your tenant and configuration ID after save.</span><button className="button button-primary" disabled={busy === 'create' || selectedMethods.length === 0}>{busy === 'create' ? 'Saving…' : 'Save gateway'}</button></div>
        </form>
      </section>}
      <section className="surface-panel gateway-list-panel"><div className="section-heading section-heading-panel"><div><h2>Configured gateways</h2><p>Secret values remain hidden. Turn off a gateway to remove it from routing.</p></div></div>
        {gateways.length ? <div className="gateway-cards">{gateways.map((gateway) => <article className="gateway-card" key={gateway.id}><div className="gateway-card-heading"><span><strong>{gateway.displayName}</strong><small>{enumLabel(gateway.provider)} · {enumLabel(gateway.environment)}</small></span><span className={`status-pill ${gateway.enabled && gateway.active ? 'status-green' : 'status-gray'}`}>{gateway.enabled && gateway.active ? 'ROUTABLE' : 'DISABLED'}</span></div><div className="gateway-meta"><span>Key <strong>{gateway.keyIdMasked ?? '—'}</strong></span><span>Webhook secret <strong>{gateway.hasWebhookSecret ? 'Configured' : 'Missing'}</strong></span><span>Priority <strong>{gateway.priority}</strong></span><span>Limits <strong>{gateway.minAmount ?? '0'} — {gateway.maxAmount ?? 'No cap'}</strong></span></div><div className="gateway-method-chips">{gateway.supportedMethods.map((method) => <span key={method}>{enumLabel(method)}</span>)}</div><div className="gateway-card-actions"><button className="text-button" disabled={!canEdit || busy === gateway.id} onClick={() => void update(gateway.id, { enabled: !gateway.enabled })}>{gateway.enabled ? 'Disable routing' : 'Enable routing'}</button><button className="text-button" disabled={!canEdit || busy === gateway.id || gateway.isDefault} onClick={() => void update(gateway.id, { isDefault: true })}>{gateway.isDefault ? 'Default route' : 'Make default'}</button><button className="text-button" onClick={() => void copyWebhook(gateway.id)}>{copied === gateway.id ? 'Copied' : 'Copy webhook URL'} <Copy size={12} /></button></div></article>)}</div> : <div className="empty-state"><span className="empty-icon"><ShieldCheck /></span><h2>No gateway configured</h2><p>Configure a provider to enable online checkout and signed payment callbacks.</p></div>}
      </section>
    </div>
  </main>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }
