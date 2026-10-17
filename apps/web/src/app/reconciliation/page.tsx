'use client';
import { formatIndianCurrency, formatIndianDate } from '../../lib/locale';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { useSession } from '../../components/session-provider';
import { Check, Scale, Upload } from 'lucide-react';

interface Gateway { id: string; provider: string; environment: string; displayName: string; active: boolean }
interface Settlement { id: string; provider: string; environment: string; settlementReference: string; settlementDate: string; grossAmount: string; gatewayFee: string; gatewayTax: string; netAmount: string; currency: string; status: string; transactionCount: number; _count: { transactions: number; records: number } }
interface RecordRow { id: string; status: string; mismatchType: string | null; expectedAmount: string | null; actualAmount: string | null; actualCurrency: string | null; difference: string | null; currency: string; notes: string | null; resolution: string | null; createdAt: string; settlement: { id: string; settlementReference: string; settlementDate: string } | null; gatewayTransaction: { provider: string; providerTxnId: string | null; providerPaymentId: string | null; amount: string; currency: string; status: string; paymentId: string | null } | null; payment: { id: string; paymentNumber: string; status: string; amount: string; currency: string; allocatedAmount: string; unallocatedAmount: string } | null; gatewayCredit: { id: string; paymentId: string | null; status: string; availableAmount: string } | null }

export default function ReconciliationPage() {
  const { user } = useSession();
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [csv, setCsv] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const canRead = hasPermission(user, 'reconciliation.read');
  const canImport = hasPermission(user, 'settlement.import');
  const canResolve = hasPermission(user, 'reconciliation.run');

  const load = useCallback(async () => {
    if (!canRead) return;
    try {
      const [settlementRows, recordRows] = await Promise.all([
        apiRequest<Settlement[]>('/reconciliation/settlements'),
        apiRequest<RecordRow[]>('/reconciliation/records'),
      ]);
      setSettlements(settlementRows); setRecords(recordRows); setError('');
      if (canImport) setGateways(await apiRequest<Gateway[]>('/reconciliation/gateways'));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Reconciliation records could not be loaded.'); }
  }, [canImport, canRead]);
  useEffect(() => { void load(); }, [load]);

  async function importSettlement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form);
    const transactions = parseTransactionRows(csv);
    if (!transactions.length) { setError('Enter one provider reference and amount per line.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ settlementReference: string; status: string; matchedCount?: number; unresolvedCount?: number; alreadyImported?: boolean }>('/reconciliation/settlements/import', { method: 'POST', body: JSON.stringify({
        gatewayConfigId: values.get('gatewayConfigId'), settlementReference: values.get('settlementReference'), settlementDate: values.get('settlementDate'),
        grossAmount: values.get('grossAmount'), gatewayFee: values.get('gatewayFee') || '0', gatewayTax: values.get('gatewayTax') || '0', netAmount: values.get('netAmount'),
        currency: String(values.get('currency') ?? '').toUpperCase(), transactions,
      }) });
      setNotice(result.alreadyImported ? `Settlement ${result.settlementReference} was already imported.` : `Settlement ${result.settlementReference}: ${result.matchedCount ?? 0} matched, ${result.unresolvedCount ?? 0} need review.`);
      form.reset(); setCsv(''); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : 'Settlement import failed.'); }
    finally { setBusy(false); }
  }

  async function resolve(id: string, status: 'RESOLVED' | 'IGNORED', resolution: string) {
    setBusy(true); setError(''); setNotice('');
    try { await apiRequest(`/reconciliation/records/${id}`, { method: 'PATCH', body: JSON.stringify({ status, resolution }) }); setNotice(`Reconciliation record ${status.toLowerCase()}.`); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Reconciliation record could not be updated.'); }
    finally { setBusy(false); }
  }

  async function releaseCapture(id: string, reason: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ alreadyReleased: boolean; credit: { status: string; availableAmount: string; currency: string } }>(`/reconciliation/records/${id}/release-capture-as-student-credit`, { method: 'POST', body: JSON.stringify({ reason }) });
      setNotice(result.alreadyReleased ? 'This capture was already assigned to student credit.' : `${result.credit.currency} ${result.credit.availableAmount} was assigned to student credit. Apply it from Credit balances, then resolve the reconciliation record.`);
      await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The captured amount could not be released as student credit.'); }
    finally { setBusy(false); }
  }

  if (!canRead) return <main id="main-content" className="page-content"><div className="page-heading"><div><p className="eyebrow">FINANCE</p><h1>Reconciliation</h1></div></div><div className="notice notice-error" role="alert">Your role needs reconciliation read access to view settlement records.</div></main>;

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">FINANCE</p><h1>Reconciliation</h1><p className="muted">Compare provider settlement lines with captured gateway transactions and review mismatches.</p></div><span className="heading-count"><Scale size={16} /> {records.filter((row) => ['OPEN', 'MISMATCHED'].includes(row.status)).length} open records</span></div>
    {notice && <div className="notice notice-success" role="status"><Check size={16} /> {notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    {canImport && <section className="surface-panel settlement-import-panel"><div className="section-heading section-heading-panel"><div><h2>Import a gateway settlement</h2><p>Paste the provider’s gross transaction lines below. Gateway fee and tax are batch totals.</p></div><Upload size={18} /></div><form className="settlement-import-form" onSubmit={importSettlement}>
      <label>Gateway<select name="gatewayConfigId" required><option value="">Choose a configured gateway</option>{gateways.map((gateway) => <option key={gateway.id} value={gateway.id}>{gateway.displayName} · {gateway.provider} · {gateway.environment}{gateway.active ? '' : ' · inactive'}</option>)}</select></label>
      <label>Settlement reference<input name="settlementReference" required maxLength={120} /></label><label>Settlement date<input name="settlementDate" required type="date" /></label><label>Currency<input name="currency" required maxLength={3} minLength={3} pattern="[A-Za-z]{3}" placeholder="Tenant settlement currency" /></label>
      <label>Gross amount<input name="grossAmount" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,4})?" /></label><label>Gateway fee<input name="gatewayFee" inputMode="decimal" defaultValue="0" pattern="[0-9]+(\.[0-9]{1,4})?" /></label><label>Gateway tax<input name="gatewayTax" inputMode="decimal" defaultValue="0" pattern="[0-9]+(\.[0-9]{1,4})?" /></label><label>Net settlement<input name="netAmount" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,4})?" /></label>
      <label className="settlement-lines-field">Provider transaction lines <small>One per line: provider reference, gross amount. References can be provider payment IDs, transaction IDs, or order IDs.</small><textarea rows={7} required value={csv} onChange={(event) => setCsv(event.target.value)} placeholder={'pay_abc123,1250.00\npay_def456,800.00'} /></label>
      <div className="settlement-import-footer"><span className="muted">The imported line total must equal gross; net must equal gross less fee and tax.</span><button className="button button-primary" disabled={busy || gateways.length === 0}>{busy ? 'Matching…' : 'Import and match'}</button></div>
    </form></section>}
    <section className="surface-panel settlement-register-panel"><div className="section-heading section-heading-panel"><div><h2>Imported settlements</h2><p>Settlement totals and provider match progress.</p></div></div>{settlements.length ? <div className="table-wrap"><table><thead><tr><th>Reference</th><th>Provider</th><th>Date</th><th>Gross</th><th>Fees + tax</th><th>Net</th><th>Matches</th><th>Status</th></tr></thead><tbody>{settlements.map((row) => <tr key={row.id}><td><strong className="mono-cell">{row.settlementReference}</strong></td><td>{row.provider} · {row.environment}</td><td>{formatIndianDate(new Date(row.settlementDate))}</td><td>{formatIndianCurrency(row.grossAmount, row.currency)}</td><td>{formatIndianCurrency(row.gatewayFee, row.currency)} + {formatIndianCurrency(row.gatewayTax, row.currency)}</td><td>{formatIndianCurrency(row.netAmount, row.currency)}</td><td>{row._count.transactions} / {row.transactionCount}</td><td><span className={`status-pill ${row.status === 'MATCHED' ? 'status-green' : row.status === 'MISMATCHED' ? 'status-red' : 'status-amber'}`}>{row.status.replaceAll('_', ' ')}</span></td></tr>)}</tbody></table></div> : <div className="empty-state"><h2>No settlements imported</h2><p>Import a provider settlement to match its lines against captured transactions.</p></div>}</section>
    <section className="surface-panel reconciliation-records-panel"><div className="section-heading section-heading-panel"><div><h2>Reconciliation records</h2><p>Missing, duplicate, late, or mismatched provider records need an operator decision.</p></div></div>{records.length ? <div className="table-wrap"><table><thead><tr><th>Created</th><th>Settlement</th><th>Mismatch</th><th>Transaction</th><th>Expected</th><th>Actual</th><th>Posting evidence</th><th>Status / action</th></tr></thead><tbody>{records.map((row) => <tr key={row.id}><td>{formatIndianDate(new Date(row.createdAt))}</td><td>{row.settlement?.settlementReference ?? '—'}</td><td><strong>{(row.mismatchType ?? 'Matched').replaceAll('_', ' ')}</strong><small className="table-subtext">{row.notes}</small></td><td className="mono-cell">{row.gatewayTransaction?.providerPaymentId ?? row.gatewayTransaction?.providerTxnId ?? '—'}</td><td>{row.expectedAmount ? formatIndianCurrency(row.expectedAmount, row.currency) : '—'}</td><td>{row.actualAmount ? formatIndianCurrency(row.actualAmount, row.actualCurrency ?? row.currency) : row.actualCurrency ? `${row.actualCurrency} · amount unavailable` : '—'}</td><td>{row.payment ? <><strong className="mono-cell">{row.payment.paymentNumber}</strong><small className="table-subtext">{row.payment.status} · allocated {formatIndianCurrency(row.payment.allocatedAmount, row.payment.currency)} · unallocated {formatIndianCurrency(row.payment.unallocatedAmount, row.payment.currency)}</small>{row.gatewayCredit && <small className="table-subtext">Student credit {row.gatewayCredit.status.toLowerCase().replaceAll('_', ' ')} · {formatIndianCurrency(row.gatewayCredit.availableAmount, row.payment.currency)}</small>}</> : <span className="muted">No payment posting yet</span>}</td><td><span className={`status-pill ${row.status === 'MATCHED' || row.status === 'RESOLVED' ? 'status-green' : row.status === 'IGNORED' ? 'status-gray' : 'status-amber'}`}>{row.status}</span>{canResolve && ['OPEN', 'MISMATCHED'].includes(row.status) && row.payment && !row.gatewayCredit && Number(row.payment.unallocatedAmount) > 0 && <details className="resolve-record"><summary>Assign to student credit</summary><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void releaseCapture(row.id, String(data.get('reason') ?? '')); }}><textarea name="reason" required minLength={5} maxLength={1000} rows={2} placeholder="Explain why this verified capture belongs to this student" /><button className="button button-secondary button-small" disabled={busy}>Create audited credit</button></form></details>}{canResolve && ['OPEN', 'MISMATCHED'].includes(row.status) && <details className="resolve-record"><summary>Review</summary><form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); void resolve(row.id, String(data.get('status')) as 'RESOLVED' | 'IGNORED', String(data.get('resolution') ?? '')); }}><select name="status" defaultValue="RESOLVED"><option value="RESOLVED">Resolve</option><option value="IGNORED">Ignore</option></select><textarea name="resolution" required minLength={3} maxLength={1000} rows={2} placeholder="Record the reconciliation decision" /><button className="button button-secondary button-small" disabled={busy}>Save decision</button></form></details>}</td></tr>)}</tbody></table></div> : <div className="empty-state"><h2>No reconciliation records</h2><p>Verified webhook mismatches and imported settlement exceptions will appear here.</p></div>}</section>
  </main>;
}

function parseTransactionRows(source: string): Array<{ providerReference: string; amount: string }> {
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.flatMap((line) => {
    const [providerReference, amount] = line.split(',').map((cell) => cell.trim());
    if (!providerReference || !amount || providerReference.toLowerCase() === 'providerreference') return [];
    return [{ providerReference, amount }];
  });
}
function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }
