'use client';
import { formatIndianCurrency, formatIndianDate } from '../../lib/locale';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { useSession } from '../../components/session-provider';
import { AlertCircle, CalendarClock, Check, CircleDollarSign, RefreshCw } from 'lucide-react';

interface Accrual {
  id: string; mode: string; daysLate: number; graceDays: number; baseAmount: string; amount: string; calculatedFor: string; waivedAmount: string;
  demand: { id: string; demandNumber: string; currency: string; status: string; student: { id: string; admissionNumber: string; firstName: string; lastName: string | null } };
  demandItem: { id: string; feeTypeName: string; dueDate: string | null; netAmount: string; paidAmount: string; waivedAmount: string } | null;
  resultDemand: { id: string; demandNumber: string; status: string; netAmount: string; currency: string } | null;
}
interface AccrueResult { processed: number; createdCount: number; skippedCount: number; created: Array<{ demandNumber: string; amount: string; taxAmount: string; currency: string }>; hasMore: boolean; nextCursor: string | null }

export default function LateFeesPage() {
  const { user } = useSession();
  const [rows, setRows] = useState<Accrual[]>([]);
  const [asOfDate, setAsOfDate] = useState(todayLocal());
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canRead = hasPermission(user, 'fee.demand.read');
  const canAccrue = hasPermission(user, 'fee.demand.create');

  const load = useCallback(async () => {
    if (!canRead) return;
    try { setRows(await apiRequest<Accrual[]>('/late-fees/accruals')); setError(''); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Late-fee accruals could not be loaded.'); }
  }, [canRead]);
  useEffect(() => { void load(); }, [load]);

  async function runAccrual() {
    setBusy(true); setError(''); setNotice('');
    try {
      let cursor: string | undefined;
      let createdCount = 0;
      let processed = 0;
      do {
        const page = await apiRequest<AccrueResult>('/late-fees/accrue', { method: 'POST', body: JSON.stringify({ asOfDate, ...(cursor ? { cursor } : {}) }) });
        createdCount += page.createdCount; processed += page.processed; cursor = page.nextCursor ?? undefined;
        if (!page.hasMore) break;
      } while (cursor);
      setNotice(`Accrual run finished for ${asOfDate}: ${createdCount} new draft demand(s), ${processed} overdue fee item(s) reviewed.`);
      await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Late fees could not be accrued. Refresh and retry the run.'); }
    finally { setBusy(false); }
  }

  if (!canRead) return <main id="main-content" className="page-content"><div className="page-heading"><div><p className="eyebrow">FEE OPERATIONS</p><h1>Late fees</h1></div></div><div className="notice notice-error" role="alert">Your role needs fee demand read access to view late-fee records.</div></main>;

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">FEE OPERATIONS</p><h1>Late fees</h1><p className="muted">Accrue tenant-configured late fees as separate demands while preserving the original fee history.</p></div><span className="heading-count"><CalendarClock size={16} /> {rows.length} recent accruals</span></div>
    {notice && <div className="notice notice-success" role="status"><Check size={16} /> {notice}</div>}{error && <div className="notice notice-error" role="alert"><AlertCircle size={16} /> {error}</div>}
    {canAccrue && <section className="surface-panel late-fee-run-panel"><div><h2>Run accrual</h2><p>One run per date is safe to retry. New charges are created as draft fee demands and need the normal demand issue approval.</p></div><label>Calculate through<input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} /></label><button className="button button-primary" onClick={() => void runAccrual()} disabled={busy || !asOfDate}><RefreshCw size={16} className={busy ? 'spin-icon' : ''} /> {busy ? 'Processing overdue items…' : 'Accrue late fees'}</button></section>}
    <section className="surface-panel late-fee-register"><div className="section-heading section-heading-panel"><div><h2>Accrual history</h2><p>Each row links an immutable charge to its source demand item.</p></div></div>{rows.length ? <div className="table-wrap"><table><thead><tr><th>Accrued for</th><th>Student</th><th>Source demand</th><th>Fee item</th><th>Days late</th><th>Base outstanding</th><th>Late fee</th><th>Resulting demand</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{formatIndianDate(new Date(row.calculatedFor))}<small className="table-subtext">{row.mode}</small></td><td>{row.demand.student.firstName} {row.demand.student.lastName ?? ''}<small className="table-subtext">{row.demand.student.admissionNumber}</small></td><td><Link className="text-link" href={`/fee-demands?search=${encodeURIComponent(row.demand.demandNumber)}`}>{row.demand.demandNumber}</Link></td><td>{row.demandItem?.feeTypeName ?? 'Fee item'}</td><td>{row.daysLate}<small className="table-subtext">{row.graceDays} grace days</small></td><td>{formatIndianCurrency(row.baseAmount, row.demand.currency)}</td><td><strong>{formatIndianCurrency(row.amount, row.demand.currency)}</strong>{Number(row.waivedAmount) > 0 && <small className="table-subtext">{formatIndianCurrency(row.waivedAmount, row.demand.currency)} waived</small>}</td><td>{row.resultDemand ? <><Link className="text-link" href={`/fee-demands?search=${encodeURIComponent(row.resultDemand.demandNumber)}`}>{row.resultDemand.demandNumber}</Link><small className="table-subtext">{row.resultDemand.status} · {formatIndianCurrency(row.resultDemand.netAmount, row.resultDemand.currency)}</small></> : 'Not billed'}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><CircleDollarSign /></span><h2>No late-fee accruals yet</h2><p>Configure late-fee behavior in <Link className="text-link" href="/settings">Institution settings</Link>, then run an accrual for an overdue period.</p></div>}</section>
  </main>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }
function dateOnly(value: string): string { return value.slice(0, 10); }
function todayLocal(): string { const date = new Date(); const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10); }
