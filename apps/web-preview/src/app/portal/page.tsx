'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSession } from '../../components/session-provider';
import { ApiError, apiRequest } from '../../lib/api';
import { launchCheckout, type CheckoutSession } from '../../lib/checkout';
import { CircleDollarSign, CreditCard, FileText, ReceiptText, ShieldCheck, UsersRound } from 'lucide-react';
import { enumLabel } from '@fee/types';

interface PortalStudent { id: string; admissionNumber: string; firstName: string; middleName: string | null; lastName: string | null; status: string }
interface PortalDemand { id: string; studentId: string; demandNumber: string; currency: string; dueDate: string; issueDate: string; status: string; netAmount: string; adjustmentAmount: string; paidAmount: string; waivedAmount: string; outstandingAmount: string; overallOutstandingAmount: string; adjustments: Array<{ id: string; adjustmentNumber: string; kind: string; direction: string; amount: string; reason: string; status: string }> }
interface PortalPayment { id: string; studentId: string; paymentNumber: string; receiptNumber: string | null; methodKind: string; amount: string; refundedAmount: string; currency: string; status: string; paidAt: string }
interface PortalInstallment { id: string; label: string; sequence: number; dueDate: string; amount: string; adjustmentAmount: string; paidAmount: string; waivedAmount: string; status: string; outstandingAmount: string; demand: { studentId: string; demandNumber: string; currency: string } }
interface PortalCredit { id: string; studentId: string; source: string; currency: string; availableAmount: string; createdAt: string; reason: string | null }
interface PortalMethod { id: string; name: string; kind: string }
interface PortalDashboard { students: PortalStudent[]; demands: PortalDemand[]; payments: PortalPayment[]; installments: PortalInstallment[]; credits: PortalCredit[]; paymentMethods: PortalMethod[] }
interface OpenItem { id: string; feeTypeName: string; outstandingAmount: string; demand: { demandNumber: string; dueDate: string; currency: string } }
interface CheckoutResult { orderId: string; orderNumber: string; status: string; message?: string; checkout?: CheckoutSession }

export default function PortalPage() {
  const { user } = useSession();
  const [data, setData] = useState<PortalDashboard | null>(null);
  const [studentId, setStudentId] = useState('');
  const [openItems, setOpenItems] = useState<OpenItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const result = await apiRequest<PortalDashboard>('/portal/dashboard');
      setData(result);
      setStudentId((current) => result.students.some((student) => student.id === current) ? current : result.students[0]?.id ?? '');
      setError('');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Your family fee information could not be loaded.'); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!studentId) { setOpenItems([]); setSelectedItems([]); return; }
    const guardianId = user?.roles.includes('PARENT') ? user.guardianId : null;
    const payerQuery = guardianId ? `?payerType=PARENT&payerGuardianId=${encodeURIComponent(guardianId)}` : '';
    void apiRequest<OpenItem[]>(`/payments/students/${studentId}/open-items${payerQuery}`).then((items) => { setOpenItems(items); setSelectedItems([]); }).catch((cause) => setError(cause instanceof ApiError ? cause.message : 'Open fee items could not be loaded.'));
  }, [studentId, user?.guardianId, user?.roles]);

  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get('payment_order');
    if (!orderId) return;
    let cancelled = false;
    async function refreshOrder() {
      try {
        for (let attempt = 0; attempt < 30 && !cancelled; attempt += 1) {
          const order = await apiRequest<{ orderNumber: string; status: string; payments: Array<{ receiptNumber: string | null }> }>(`/gateways/orders/${orderId}`);
          if (cancelled) return;
          if (order.status === 'SUCCESS') { setNotice(`Payment ${order.orderNumber} is confirmed. Receipt ${order.payments[0]?.receiptNumber ?? 'is being prepared'}.`); await load(); return; }
          if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(order.status)) { setError(`Payment ${order.orderNumber} ended with status ${order.status.toLowerCase()}.`); return; }
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
        }
        if (!cancelled) setNotice('Provider confirmation is still pending. The signed callback will update this page when payment settles.');
      } catch (cause) { if (!cancelled) setError(cause instanceof ApiError ? cause.message : 'Payment status could not be refreshed.'); }
    }
    void refreshOrder();
    return () => { cancelled = true; };
  }, [load]);

  async function startCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!studentId) return;
    const values = new FormData(event.currentTarget);
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<CheckoutResult>('/gateways/orders', { method: 'POST', body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(), studentId, methodId: values.get('methodId'), amount: values.get('amount'),
        demandItemIds: selectedItems.length ? selectedItems : undefined,
        payerType: user?.roles.includes('PARENT') ? 'PARENT' : 'STUDENT',
        payerName: [user?.firstName, user?.lastName].filter(Boolean).join(' '),
        payerGuardianId: user?.roles.includes('PARENT') ? user.guardianId : undefined,
      }) });
      if (result.status !== 'INITIATED' || !result.checkout) throw new Error(result.message ?? 'The payment provider could not start checkout.');
      setNotice(`Payment order ${result.orderNumber} was created. Payment is confirmed only after the provider callback.`);
      await launchCheckout(result.checkout, result.orderNumber);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : 'Online checkout could not be started.'); }
    finally { setBusy(false); }
  }

  const studentName = (id: string) => { const student = data?.students.find((row) => row.id === id); return student ? [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ') : 'Student'; };

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">STUDENT AND PARENT PORTAL</p><h1>Your family account</h1><p className="muted">View fee balances, installments, receipts, and secure online payment options.</p></div><span className="heading-count"><ShieldCheck size={16} /> Private to your account</span></div>
    {notice && <div className="notice notice-info" role="status">{notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    {!data ? <section className="surface-panel"><p className="muted">Loading your fee information…</p></section> : <>
      {data.students.length > 1 && <label className="portal-student-picker">Student<select value={studentId} onChange={(event) => setStudentId(event.target.value)}>{data.students.map((student) => <option key={student.id} value={student.id}>{student.admissionNumber} · {studentName(student.id)}</option>)}</select></label>}
      <section className="portal-student-grid" aria-label="Linked students">{data.students.map((student) => {
        const outstanding = data.demands.filter((demand) => demand.studentId === student.id);
        return <article className="surface-panel portal-student-card" key={student.id}><span className="metric-icon blue"><UsersRound size={19} /></span><p>{student.admissionNumber}</p><h2>{studentName(student.id)}</h2><small>{outstanding.length} open fee demands</small></article>;
      })}</section>
      {studentId && <section className="surface-panel portal-checkout-panel"><div className="section-heading section-heading-panel"><div><h2>Pay fees online</h2><p>Choose open items or enter an amount. Only the signed gateway confirmation records a payment.</p></div><CreditCard size={19} /></div>
        {data.paymentMethods.length ? <form className="portal-checkout-form" onSubmit={startCheckout}>
          <label>Payment method<select name="methodId" required defaultValue=""><option value="">Choose method</option>{data.paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name} · {enumLabel(method.kind)}</option>)}</select></label>
          <label>Amount<input name="amount" required inputMode="decimal" placeholder="0.00" pattern="[0-9]+(\.[0-9]{1,4})?" /></label>
          <div className="portal-open-items"><div className="open-items-heading"><strong>Open fee items · {studentName(studentId)}</strong><span>{selectedItems.length ? `${selectedItems.length} selected` : 'Oldest due first'}</span></div>{openItems.length ? openItems.map((item) => <label className="open-item-row" key={item.id}><input type="checkbox" checked={selectedItems.includes(item.id)} onChange={() => setSelectedItems((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span><strong>{item.feeTypeName}</strong><small>{item.demand.demandNumber} · due {new Date(item.demand.dueDate).toLocaleDateString()}</small></span><b>{item.demand.currency} {item.outstandingAmount}</b></label>) : <p className="muted">No open fee items are available for this student.</p>}</div>
          <div className="payment-submit-row"><span className="muted">The institution’s payment rules and gateway limits still apply.</span><button className="button button-primary" disabled={busy}>{busy ? 'Starting checkout…' : 'Continue to secure checkout'} <ShieldCheck size={15} /></button></div>
        </form> : <div className="empty-state"><h2>Online payment is not available</h2><p>The institution has not enabled an online payment method.</p></div>}
      </section>}
      <section className="surface-panel portal-data-panel"><div className="section-heading section-heading-panel"><div><h2>Fee demands</h2><p>Current and recent balances across linked students.</p></div><FileText size={18} /></div>{data.demands.length ? <div className="table-wrap"><table><thead><tr><th>Student</th><th>Demand</th><th>Due date</th><th>Your share due</th><th>Status</th></tr></thead><tbody>{data.demands.map((demand) => <tr key={demand.id}><td>{studentName(demand.studentId)}</td><td><strong className="mono-cell">{demand.demandNumber}</strong></td><td>{new Date(demand.dueDate).toLocaleDateString()}</td><td><strong>{demand.currency} {demand.outstandingAmount}</strong>{demand.overallOutstandingAmount !== demand.outstandingAmount && <small className="table-subtext">Total demand still open {demand.currency} {demand.overallOutstandingAmount}</small>}<small className="table-subtext">{demand.adjustments.map((row) => `${row.adjustmentNumber} · ${row.amount} · ${row.reason}`).join(' · ')}</small></td><td><span className={`status-pill ${demand.status === 'OVERDUE' ? 'status-red' : 'status-amber'}`}>{enumLabel(demand.status)}</span></td></tr>)}</tbody></table></div> : <p className="muted">No outstanding fee demands.</p>}</section>
      <section className="surface-panel portal-data-panel"><div className="section-heading section-heading-panel"><div><h2>Installments</h2><p>Saved payment schedule balances for your family.</p></div><CircleDollarSign size={18} /></div>{data.installments.length ? <div className="table-wrap"><table><thead><tr><th>Student</th><th>Demand</th><th>Installment</th><th>Due date</th><th>Remaining</th><th>Status</th></tr></thead><tbody>{data.installments.map((row) => <tr key={row.id}><td>{studentName(row.demand.studentId)}</td><td>{row.demand.demandNumber}</td><td>{row.sequence}. {row.label}</td><td>{new Date(row.dueDate).toLocaleDateString()}</td><td>{row.demand.currency} {row.outstandingAmount}<small className="table-subtext">Adjustment {row.adjustmentAmount}</small></td><td>{enumLabel(row.status)}</td></tr>)}</tbody></table></div> : <p className="muted">No installment schedules found.</p>}</section>
      <section className="surface-panel portal-data-panel"><div className="section-heading section-heading-panel"><div><h2>Payments and receipts</h2><p>Confirmed payments with their immutable receipt references.</p></div><ReceiptText size={18} /></div>{data.payments.length ? <div className="table-wrap"><table><thead><tr><th>Student</th><th>Payment</th><th>Date</th><th>Method</th><th>Amount</th><th>Receipt</th></tr></thead><tbody>{data.payments.map((payment) => <tr key={payment.id}><td>{studentName(payment.studentId)}</td><td><strong className="mono-cell">{payment.paymentNumber}</strong></td><td>{new Date(payment.paidAt).toLocaleDateString()}</td><td>{enumLabel(payment.methodKind)}</td><td>{payment.currency} {payment.amount}</td><td>{payment.receiptNumber ?? '—'}</td></tr>)}</tbody></table></div> : <p className="muted">No confirmed payments yet.</p>}</section>
      {data.credits.length > 0 && <section className="surface-panel portal-data-panel"><div className="section-heading section-heading-panel"><div><h2>Available credits</h2><p>Unallocated balances can be applied by the institution to future demands.</p></div></div><div className="portal-credit-list">{data.credits.map((credit) => <div key={credit.id}><span>{studentName(credit.studentId)} · {enumLabel(credit.source)}<small>{credit.reason ?? 'Available balance'}</small></span><strong>{credit.currency} {credit.availableAmount}</strong></div>)}</div></section>}
    </>}
  </main>;
}
