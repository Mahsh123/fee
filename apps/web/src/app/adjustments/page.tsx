'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BadgePercent, Check, CircleAlert, RotateCcw } from 'lucide-react';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { useSession } from '../../components/session-provider';
import { enumLabel } from '@fee/types';

interface Student { id: string; admissionNumber: string; firstName: string; middleName: string | null; lastName: string | null }
interface InstallmentTarget { id: string; amount: string; adjustmentAmount: string; paidAmount: string; balance: string; installment: { label: string; sequence: number; dueDate: string; status: string } }
interface DemandItemTarget { id: string; demandId: string; demandNumber: string; demandStatus: string; feeTypeCode: string; feeTypeName: string; currency: string; dueDate: string; balance: string; installmentItems: InstallmentTarget[] }
interface TargetResponse { student: Student; items: DemandItemTarget[] }
interface AdjustmentRow { id: string; adjustmentNumber: string; demandId: string | null; demandItemId: string | null; installmentItemId: string | null; studentId: string | null; kind: string; status: string; direction: string; amount: string; currency: string; reason: string; requestedBy: string | null; approvedBy: string | null; reversalOfAdjustmentId: string | null; hasReversal: boolean; createdAt: string; demand: { demandNumber: string; currency: string; status: string } | null; student: { admissionNumber: string; firstName: string; middleName: string | null; lastName: string | null } | null }
interface Page<T> { items: T[]; pagination: { total: number } }

const kinds = ['DEBIT_ADJUSTMENT', 'CREDIT_ADJUSTMENT', 'WRITE_OFF', 'WAIVER', 'CORRECTION'] as const;
type AdjustmentKind = (typeof kinds)[number];

export default function AdjustmentsPage() {
  const { user } = useSession();
  const canRead = hasPermission(user, 'adjustment.read');
  const canCreate = hasPermission(user, 'adjustment.create');
  const canApprove = hasPermission(user, 'adjustment.approve');
  const [students, setStudents] = useState<Student[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([]);
  const [studentId, setStudentId] = useState('');
  const [targets, setTargets] = useState<DemandItemTarget[]>([]);
  const [demandItemId, setDemandItemId] = useState('');
  const [installmentItemId, setInstallmentItemId] = useState('');
  const [kind, setKind] = useState<AdjustmentKind>('CREDIT_ADJUSTMENT');
  const [direction, setDirection] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const [studentPage, page] = await Promise.all([
        canCreate ? apiRequest<Page<Student>>('/students?pageSize=500&sort=admissionNumber') : Promise.resolve({ items: [], pagination: { total: 0 } }),
        canRead ? apiRequest<Page<AdjustmentRow>>('/adjustments?pageSize=500') : Promise.resolve({ items: [], pagination: { total: 0 } }),
      ]);
      setStudents(studentPage.items);
      setAdjustments(page.items);
      setError('');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Adjustment data could not be loaded.'); }
  }, [canCreate, canRead]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!studentId || !canCreate) { setTargets([]); setDemandItemId(''); setInstallmentItemId(''); return; }
    let active = true;
    void apiRequest<TargetResponse>(`/adjustments/targets?studentId=${encodeURIComponent(studentId)}`)
      .then((result) => { if (active) { setTargets(result.items); setDemandItemId(''); setInstallmentItemId(''); } })
      .catch((cause) => { if (active) setError(cause instanceof ApiError ? cause.message : 'Eligible fee items could not be loaded.'); });
    return () => { active = false; };
  }, [studentId, canCreate]);

  const selectedItem = useMemo(() => targets.find((row) => row.id === demandItemId) ?? null, [targets, demandItemId]);
  const selectedInstallment = useMemo(() => selectedItem?.installmentItems.find((row) => row.id === installmentItemId) ?? null, [selectedItem, installmentItemId]);
  const targetBalance = selectedInstallment?.balance ?? selectedItem?.balance ?? '0.0000';

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedItem) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy('create'); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ adjustment: AdjustmentRow; requiresApproval: boolean; approvalRequestId: string | null }>('/adjustments', {
        method: 'POST',
        body: JSON.stringify({
          idempotencyKey: crypto.randomUUID(), demandItemId: selectedItem.id,
          installmentItemId: selectedItem.installmentItems.length ? installmentItemId : undefined,
          kind, ...(kind === 'CORRECTION' ? { direction } : {}), amount: String(form.get('amount') ?? '').trim(), reason: String(form.get('reason') ?? '').trim(),
        }),
      });
      setNotice(result.requiresApproval ? `Adjustment ${result.adjustment.adjustmentNumber} is waiting for approval.` : `Adjustment ${result.adjustment.adjustmentNumber} was posted to the demand and ledger.`);
      formElement.reset(); setDemandItemId(''); setInstallmentItemId('');
      await load();
      if (studentId) {
        const refreshed = await apiRequest<TargetResponse>(`/adjustments/targets?studentId=${encodeURIComponent(studentId)}`);
        setTargets(refreshed.items);
      }
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The adjustment could not be created.'); }
    finally { setBusy(''); }
  }

  async function decide(row: AdjustmentRow, approved: boolean) {
    setBusy(row.id); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ adjustment: AdjustmentRow }>(`/adjustments/${row.id}/decision`, { method: 'POST', body: JSON.stringify({ approved, note: approved ? 'Approved from finance adjustments' : 'Rejected from finance adjustments' }) });
      setNotice(approved ? `Adjustment ${row.adjustmentNumber} was approved and posted.` : `Adjustment ${row.adjustmentNumber} was rejected.`);
      await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The approval decision could not be saved.'); }
    finally { setBusy(''); }
  }

  async function reverse(row: AdjustmentRow) {
    const reason = window.prompt(`Why are you reversing ${row.adjustmentNumber}?`);
    if (!reason?.trim()) return;
    setBusy(row.id); setError(''); setNotice('');
    try {
      await apiRequest(`/adjustments/${row.id}/reverse`, { method: 'POST', body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), reason: reason.trim() }) });
      setNotice(`A compensating adjustment was posted for ${row.adjustmentNumber}.`);
      await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The adjustment could not be reversed.'); }
    finally { setBusy(''); }
  }

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">FINANCE</p><h1>Adjustments</h1><p className="muted">Correct issued demands with traceable credit, debit, waiver, and write-off entries.</p></div><span className="heading-count"><BadgePercent size={16} /> {adjustments.length} records</span></div>
    {notice && <div className="notice notice-success" role="status"><Check size={16} /> {notice}</div>}{error && <div className="notice notice-error" role="alert"><CircleAlert size={16} /> {error}</div>}
    {canCreate && <section className="surface-panel adjustment-create-panel"><div className="section-heading section-heading-panel"><div><h2>Record a demand adjustment</h2><p>Choose the exact fee item and, when scheduled, the installment share it changes.</p></div></div><form className="payment-form" onSubmit={create}>
      <label className="payment-form-wide">Student<select value={studentId} onChange={(event) => setStudentId(event.target.value)} required><option value="">Choose a student</option>{students.map((student) => <option key={student.id} value={student.id}>{student.admissionNumber} · {[student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ')}</option>)}</select></label>
      <label className="payment-form-wide">Issued fee item<select value={demandItemId} onChange={(event) => { setDemandItemId(event.target.value); setInstallmentItemId(''); }} required><option value="">Choose a demand item</option>{targets.map((item) => <option key={item.id} value={item.id}>{item.demandNumber} · {item.feeTypeName} · due {item.currency} {item.balance}</option>)}</select></label>
      {selectedItem?.installmentItems.length ? <label className="payment-form-wide">Installment share<select value={installmentItemId} onChange={(event) => setInstallmentItemId(event.target.value)} required><option value="">Choose an installment</option>{selectedItem.installmentItems.map((share) => <option key={share.id} value={share.id}>{share.installment.sequence}. {share.installment.label} · {new Date(share.installment.dueDate).toLocaleDateString()} · {selectedItem.currency} {share.balance}</option>)}</select></label> : null}
      <label>Adjustment type<select value={kind} onChange={(event) => setKind(event.target.value as AdjustmentKind)}>{kinds.map((value) => <option key={value} value={value}>{enumLabel(value)}</option>)}</select></label>
      {kind === 'CORRECTION' && <label>Correction direction<select value={direction} onChange={(event) => setDirection(event.target.value as 'CREDIT' | 'DEBIT')}><option value="CREDIT">Reduce amount due</option><option value="DEBIT">Increase amount due</option></select></label>}
      <label>Amount<input name="amount" required inputMode="decimal" placeholder={`Current balance ${targetBalance}`} pattern="[0-9]+(\.[0-9]{1,4})?" /></label>
      <label className="payment-form-wide">Reason<textarea name="reason" required maxLength={1000} rows={3} placeholder="Explain why this correction is needed" /></label>
      <div className="payment-form-wide payment-submit-row"><span className="muted">The original demand, installment schedule, and invoice snapshots remain preserved.</span><button className="button button-primary" disabled={busy === 'create' || !selectedItem || Boolean(selectedItem.installmentItems.length && !installmentItemId)}>{busy === 'create' ? 'Posting…' : 'Record adjustment'} <BadgePercent size={15} /></button></div>
    </form>{!targets.length && studentId && <p className="muted adjustment-empty-note">This student has no issued fee items to adjust.</p>}</section>}
    {!canCreate && <div className="notice notice-info">Your role can review adjustments but cannot create them.</div>}
    {canRead ? <section className="surface-panel adjustment-history-panel"><div className="section-heading section-heading-panel"><div><h2>Adjustment history</h2><p>Approvals, posted financial corrections, and compensating reversals are recorded here.</p></div></div>{adjustments.length ? <div className="table-wrap"><table><thead><tr><th>Adjustment</th><th>Student / demand</th><th>Type</th><th>Amount</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead><tbody>{adjustments.map((row) => <tr key={row.id}><td><strong className="mono-cell">{row.adjustmentNumber}</strong><small className="table-subtext">{new Date(row.createdAt).toLocaleDateString()}{row.reversalOfAdjustmentId ? ' · reversal' : ''}</small></td><td>{row.student ? <><strong>{row.student.admissionNumber}</strong><small className="table-subtext">{row.demand?.demandNumber ?? 'Demand'}</small></> : row.demand?.demandNumber ?? '—'}</td><td>{enumLabel(row.kind)}<small className="table-subtext">{row.direction === 'CREDIT' ? 'Reduces balance' : 'Increases balance'}</small></td><td><strong>{row.currency} {row.direction === 'CREDIT' ? '−' : '+'}{row.amount}</strong></td><td>{row.reason}</td><td><span className={`status-pill ${row.status === 'APPLIED' ? 'status-green' : row.status === 'PENDING_APPROVAL' ? 'status-amber' : row.status === 'REJECTED' ? 'status-red' : 'status-gray'}`}>{enumLabel(row.status)}</span></td><td>{row.status === 'PENDING_APPROVAL' && canApprove ? <span className="refund-actions"><button className="text-button" disabled={busy === row.id} onClick={() => void decide(row, true)}>Approve</button><button className="text-button text-danger" disabled={busy === row.id} onClick={() => void decide(row, false)}>Reject</button></span> : row.status === 'APPLIED' && !row.hasReversal && !row.reversalOfAdjustmentId && canApprove ? <button className="button button-secondary button-small" disabled={busy === row.id} onClick={() => void reverse(row)}><RotateCcw size={14} /> Reverse</button> : <span className="muted">—</span>}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><BadgePercent /></span><h2>No adjustments recorded</h2><p>Demand credits, debit corrections, waivers, and write-offs will appear here.</p></div>}</section> : <div className="notice notice-info">Your role does not include adjustment history access.</div>}
  </main>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }
