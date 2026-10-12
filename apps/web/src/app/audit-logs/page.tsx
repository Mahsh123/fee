'use client';
import { formatIndianDateTime, formatIndianNumber } from '../../lib/locale';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Eye, Search, ShieldCheck } from 'lucide-react';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { useSession } from '../../components/session-provider';

interface AuditEntry {
  id: string; actorId: string | null; actorType: string; actorEmail: string | null; actorRoles: string[]; action: string;
  entityType: string; entityId: string | null; entityRef: string | null; reason: string | null; requestId: string | null;
  severity: string; prevHash: string | null; hash: string | null; createdAt: string;
}
interface AuditDetail extends AuditEntry { before: unknown; after: unknown; diff: unknown; ipAddress: string | null; userAgent: string | null }
interface AuditResult { items: AuditEntry[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }
interface Integrity { intact: boolean; checked: number; brokenAt?: string }
interface AuditFilters { search: string; action: string; entityType: string; from: string; to: string }

export default function AuditLogsPage() {
  const { user } = useSession();
  const [result, setResult] = useState<AuditResult | null>(null);
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [filters, setFilters] = useState<AuditFilters>({ search: '', action: '', entityType: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canRead = hasPermission(user, 'audit.read');

  const load = useCallback(async () => {
    if (!canRead) return;
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '50', sort: '-createdAt' });
      if (filters.search) params.set('search', filters.search);
      if (filters.action) params.set('action', filters.action);
      if (filters.entityType) params.set('entityType', filters.entityType);
      if (filters.from) params.set('from', filters.from);
      if (filters.to) params.set('to', filters.to);
      const data = await apiRequest<AuditResult>(`/audit-logs?${params.toString()}`);
      setResult(data);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The audit trail could not be loaded.'); }
  }, [canRead, page, filters]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!canRead) return;
    void apiRequest<Integrity>('/audit-logs/integrity').then(setIntegrity).catch(() => setIntegrity(null));
  }, [canRead]);

  async function openEntry(id: string) {
    setSelectedId(id); setDetail(null); setError('');
    try { setDetail(await apiRequest<AuditDetail>(`/audit-logs/${id}`)); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Audit entry details could not be loaded.'); }
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setPage(1); setFilters({ search: search.trim(), action: action.trim(), entityType: entityType.trim(), from, to }); }

  if (!canRead) return <main id="main-content" className="page-content"><div className="page-heading"><div><p className="eyebrow">GOVERNANCE</p><h1>Audit logs</h1></div></div><div className="notice notice-error" role="alert">Your role needs audit read access to view institution activity.</div></main>;

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">GOVERNANCE</p><h1>Audit logs</h1><p className="muted">Review who changed institution records and inspect the tenant audit chain.</p></div>{integrity && <span className={`audit-integrity ${integrity.intact ? '' : 'broken'}`}>{integrity.intact ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} <strong>{integrity.intact ? 'Chain links intact' : 'Chain issue found'}</strong><small>{formatIndianDateTime(integrity.checked)} entries checked</small></span>}</div>
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    <form className="surface-panel audit-filter-panel" onSubmit={applyFilters}><label>Search<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Action, entity, or actor" /></label><label>Action<input value={action} onChange={(event) => setAction(event.target.value)} placeholder="Exact action" /></label><label>Entity type<input value={entityType} onChange={(event) => setEntityType(event.target.value)} placeholder="e.g. Payment" /></label><label>From date<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Through date<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="button button-secondary"><Search size={15} /> Filter</button></form>
    <section className="surface-panel"><div className="section-heading section-heading-panel"><div><h2>Activity</h2><p>{formatIndianNumber(result?.pagination.total) ?? '—'} tenant audit entries</p></div><ShieldCheck size={17} /></div>
      {result?.items.length ? <><div className="table-wrap"><table><thead><tr><th>Time</th><th>Actor</th><th>Action / entity</th><th>Severity</th><th>Entry hash</th><th></th></tr></thead><tbody>{result.items.map((entry) => <tr key={entry.id}><td>{formatIndianDateTime(new Date(entry.createdAt))}</td><td><span className="audit-actor"><strong>{entry.actorEmail || entry.actorType}</strong><small>{entry.actorRoles.join(', ') || (entry.actorId ? entry.actorId.slice(0, 8) : 'System')}</small></span></td><td><span className="audit-action"><strong>{entry.action.replaceAll('_', ' ')}</strong><small>{entry.entityType}{entry.entityRef ? ` · ${entry.entityRef}` : entry.entityId ? ` · ${entry.entityId.slice(0, 8)}` : ''}</small></span></td><td><span className={`status-pill ${entry.severity === 'CRITICAL' ? 'status-red' : entry.severity === 'WARN' ? 'status-amber' : 'status-gray'}`}>{entry.severity}</span></td><td><code className="audit-hash" title={entry.hash ?? undefined}>{entry.hash ?? '—'}</code></td><td><button className="text-button" onClick={() => void openEntry(entry.id)} aria-label={`Inspect ${entry.action}`}><Eye size={14} /> Inspect</button></td></tr>)}</tbody></table></div><div className="table-footer"><span>Page {result.pagination.page} of {Math.max(result.pagination.totalPages, 1)}</span><div className="pagination-actions"><button className="button button-secondary button-small" onClick={() => setPage((current) => Math.max(current - 1, 1))} disabled={page <= 1}><ChevronLeft size={14} /> Previous</button><button className="button button-secondary button-small" onClick={() => setPage((current) => current + 1)} disabled={page >= result.pagination.totalPages}>Next <ChevronRight size={14} /></button></div></div></> : result ? <div className="empty-state"><span className="empty-icon"><ShieldCheck /></span><h2>No audit entries found</h2><p>Try a wider date range or clear one of the filters.</p></div> : <div className="loading-table">Loading audit entries…</div>}
    </section>
    {selectedId && <section className="surface-panel audit-detail-panel"><div className="section-heading section-heading-panel"><div><h2>Entry details</h2><p>{detail ? `${detail.action} · ${formatIndianDateTime(new Date(detail.createdAt))}` : 'Loading selected record…'}</p></div><button className="text-button" onClick={() => { setSelectedId(''); setDetail(null); }}>Close</button></div>{detail && <><dl className="student-detail-list"><div><dt>Actor</dt><dd>{detail.actorEmail || detail.actorType}</dd></div><div><dt>Request ID</dt><dd>{detail.requestId || '—'}</dd></div><div><dt>Entity</dt><dd>{detail.entityType} · {detail.entityRef || detail.entityId || '—'}</dd></div><div><dt>Reason</dt><dd>{detail.reason || '—'}</dd></div><div><dt>Previous hash</dt><dd className="mono-cell">{detail.prevHash || 'Genesis'}</dd></div><div><dt>Current hash</dt><dd className="mono-cell">{detail.hash || '—'}</dd></div></dl><div className="audit-detail-grid"><div><h3>Before</h3><pre>{formatJson(detail.before)}</pre></div><div><h3>After</h3><pre>{formatJson(detail.after)}</pre></div></div></>}</section>}
  </main>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }
function formatJson(value: unknown): string { return value == null ? 'No snapshot recorded.' : JSON.stringify(value, null, 2); }
