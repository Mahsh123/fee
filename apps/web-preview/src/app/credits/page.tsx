'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CircleDollarSign, Check, RefreshCw } from 'lucide-react';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { useSession } from '../../components/session-provider';

interface Student { id: string; admissionNumber: string; firstName: string; middleName: string | null; lastName: string | null }
interface Credit { id: string; studentId: string | null; source: string; status: string; currency: string; originalAmount: string; availableAmount: string; allocatedAmount: string; refundedAmount: string; expiresAt: string | null; reason: string | null }
interface OpenItem { id: string; feeTypeName: string; outstandingAmount: string; demand: { demandNumber: string; dueDate: string; currency: string }; installmentShares?: Array<{ amount: string; paidAmount: string; installment: { label: string; dueDate: string; sequence: number } }> }
interface Page<T> { items: T[]; pagination: { total: number } }

export default function CreditsPage() {
  const { user } = useSession();
  const [students, setStudents] = useState<Student[]>([]);
  const [credits, setCredits] = useState<Credit[]>([]);
  const [openItems, setOpenItems] = useState<OpenItem[]>([]);
  const [studentId, setStudentId] = useState('');
  const [selectedCredits, setSelectedCredits] = useState<string[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const canRead = hasPermission(user, 'credit.read');
  const canApply = hasPermission(user, 'credit.apply');

  const load = useCallback(async () => {
    try {
      const [studentPage, creditPage] = await Promise.all([
        apiRequest<Page<Student>>('/students?pageSize=500&sort=admissionNumber'),
        canRead ? apiRequest<Page<Credit>>('/credits?pageSize=500&sort=createdAt') : Promise.resolve({ items: [], pagination: { total: 0 } }),
      ]);
      setStudents(studentPage.items); setCredits(creditPage.items); setError('');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Credit balances could not be loaded.'); }
  }, [canRead]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!studentId) { setOpenItems([]); setSelectedItems([]); setSelectedCredits([]); return; }
    void apiRequest<OpenItem[]>(`/payments/students/${studentId}/open-items`).then((items) => { setOpenItems(items); setSelectedItems([]); setSelectedCredits([]); })
      .catch((cause) => setError(cause instanceof ApiError ? cause.message : 'Outstanding fee items could not be loaded.'));
  }, [studentId]);

  const studentCredits = useMemo(() => credits.filter((credit) => credit.studentId === studentId && Number(credit.availableAmount) > 0 && (!credit.expiresAt || new Date(credit.expiresAt).getTime() > Date.now())), [credits, studentId]);
  const availableTotal = studentCredits.reduce((total, credit) => total + Number(credit.availableAmount), 0);
  const selectedBalance = (selectedItems.length ? openItems.filter((item) => selectedItems.includes(item.id)) : openItems).reduce((total, item) => total + Number(item.outstandingAmount), 0);
  const maximum = Math.min(availableTotal, selectedBalance);

  function renewKey() { setIdempotencyKey(crypto.randomUUID()); }
  function toggle(id: string, selected: string[], update: (next: string[]) => void) { update(selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id]); renewKey(); }

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!studentId) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ amount: string; currency: string; allocations: unknown[] }>('/credits/apply', {
        method: 'POST',
        body: JSON.stringify({ idempotencyKey: idempotencyKey || crypto.randomUUID(), studentId, amount: String(form.get('amount') ?? '').trim() || undefined, creditIds: selectedCredits.length ? selectedCredits : undefined, demandItemIds: selectedItems.length ? selectedItems : undefined }),
      });
      setNotice(`${result.currency} ${result.amount} applied across ${result.allocations.length} allocation rows. Demand, installment, and ledger balances were updated together.`);
      setSelectedCredits([]); setSelectedItems([]); setIdempotencyKey(''); await load();
      const items = await apiRequest<OpenItem[]>(`/payments/students/${studentId}/open-items`); setOpenItems(items);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Credit could not be applied.'); }
    finally { setBusy(false); }
  }

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">FINANCE</p><h1>Credit balances</h1><p className="muted">Review overpayments and advance balances, then apply them to outstanding demands.</p></div><span className="heading-count"><CircleDollarSign size={16} /> {studentCredits.length} available for this student</span></div>
    {notice && <div className="notice notice-success" role="status"><Check size={16} /> {notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    {!canRead && <div className="notice notice-error" role="alert">Your role needs credit read access to review student balances.</div>}
    <div className="credit-workspace">
      <section className="surface-panel credit-apply-panel">
        <div className="section-heading section-heading-panel"><div><h2>Apply student credit</h2><p>Credits and open items are selected FIFO by date unless you choose specific rows.</p></div><RefreshCw size={18} /></div>
        {!canApply ? <div className="empty-state"><h2>Credit application access required</h2><p>Your role does not include the permission to apply credit.</p></div> : <form className="payment-form" onChange={renewKey} onSubmit={apply}>
          <label className="payment-form-wide">Student<select value={studentId} onChange={(event) => setStudentId(event.target.value)} required><option value="">Choose a student</option>{students.map((student) => <option key={student.id} value={student.id}>{student.admissionNumber} · {[student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ')}</option>)}</select></label>
          <label>Apply amount<input name="amount" inputMode="decimal" placeholder={`Up to ${maximum.toFixed(2)}`} pattern="[0-9]+(\.[0-9]{1,4})?" /></label>
          <div className="credit-summary"><span>Available credit <strong>{studentCredits[0]?.currency ?? ''} {availableTotal.toFixed(2)}</strong></span><span>Selected fees due <strong>{openItems[0]?.demand.currency ?? ''} {selectedBalance.toFixed(2)}</strong></span><span>Maximum application <strong>{openItems[0]?.demand.currency ?? studentCredits[0]?.currency ?? ''} {maximum.toFixed(2)}</strong></span></div>
          {studentId && <div className="payment-form-wide open-items-box"><div className="open-items-heading"><strong>Available credits</strong><span>{selectedCredits.length ? `${selectedCredits.length} selected` : 'Oldest credit first'}</span></div>{studentCredits.length ? studentCredits.map((credit) => <label className="open-item-row" key={credit.id}><input type="checkbox" checked={selectedCredits.includes(credit.id)} onChange={() => toggle(credit.id, selectedCredits, setSelectedCredits)} /><span><strong>{credit.source.replaceAll('_', ' ')}</strong><small>{credit.reason ?? credit.id.slice(0, 8)} · {credit.expiresAt ? `expires ${new Date(credit.expiresAt).toLocaleDateString()}` : 'no expiry'}</small></span><b>{credit.currency} {credit.availableAmount}</b></label>) : <p className="muted">No available balances for this student.</p>}</div>}
          {studentId && <div className="payment-form-wide open-items-box"><div className="open-items-heading"><strong>Outstanding demands</strong><span>{selectedItems.length ? `${selectedItems.length} selected` : 'Oldest installment first'}</span></div>{openItems.length ? openItems.map((item) => { const next = item.installmentShares?.find((share) => Number(share.amount) > Number(share.paidAmount)); return <label className="open-item-row" key={item.id}><input type="checkbox" checked={selectedItems.includes(item.id)} onChange={() => toggle(item.id, selectedItems, setSelectedItems)} /><span><strong>{item.feeTypeName}</strong><small>{item.demand.demandNumber} · {next ? `${next.installment.label} due ${new Date(next.installment.dueDate).toLocaleDateString()}` : `due ${new Date(item.demand.dueDate).toLocaleDateString()}`}</small></span><b>{item.demand.currency} {item.outstandingAmount}</b></label>}) : <p className="muted">No open demand balances are available.</p>}</div>}
          <div className="payment-form-wide payment-submit-row"><span className="muted">The application creates exact credit allocations and matching ledger entries.</span><button className="button button-primary" disabled={busy || maximum <= 0}>{busy ? 'Applying…' : 'Apply credit'} <Check size={15} /></button></div>
        </form>}
      </section>
      <section className="surface-panel credit-history-panel"><div className="section-heading section-heading-panel"><div><h2>Credit history</h2><p>Balances include available, applied, and refunded totals.</p></div></div>{studentCredits.length ? <div className="table-wrap"><table><thead><tr><th>Source</th><th>Original</th><th>Available</th><th>Applied</th><th>Refunded</th><th>Status</th></tr></thead><tbody>{studentCredits.map((credit) => <tr key={credit.id}><td><strong>{credit.source.replaceAll('_', ' ')}</strong><small className="table-subtext">{credit.reason ?? credit.id.slice(0, 8)}</small></td><td>{credit.currency} {credit.originalAmount}</td><td><strong>{credit.currency} {credit.availableAmount}</strong></td><td>{credit.currency} {credit.allocatedAmount}</td><td>{credit.currency} {credit.refundedAmount}</td><td><span className="status-pill status-green">{credit.status.replaceAll('_', ' ')}</span></td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><CircleDollarSign /></span><h2>No available credit</h2><p>Overpayments and advance balances appear after a payment is recorded.</p></div>}</section>
    </div>
  </main>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }
