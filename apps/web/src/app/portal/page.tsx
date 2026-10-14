'use client';
import { formatIndianCurrency, formatIndianDate } from '../../lib/locale';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSession } from '../../components/session-provider';
import { ApiError, apiDownload, apiRequest } from '../../lib/api';
import { launchCheckout, type CheckoutSession } from '../../lib/checkout';
import { CircleDollarSign, CreditCard, FileText, Printer, ReceiptText, ShieldCheck, UsersRound, X } from 'lucide-react';
import { enumLabel } from '@fee/types';

interface PortalStudent { id: string; admissionNumber: string; firstName: string; middleName: string | null; lastName: string | null; status: string }
interface PortalPerson { id: string; personNumber: string; typeKey: string; typeLabel: string; firstName: string; middleName: string | null; lastName: string | null; preferredName: string | null; status: string; branch: { id: string; name: string; code: string } | null }
interface PortalDemand { id: string; studentId: string | null; personId?: string | null; demandNumber: string; financialPeriod: string | null; currency: string; dueDate: string; issueDate: string; status: string; netAmount: string; adjustmentAmount: string; paidAmount: string; waivedAmount: string; outstandingAmount: string; overallOutstandingAmount: string; adjustments: Array<{ id: string; adjustmentNumber: string; kind: string; direction: string; amount: string; reason: string; status: string }> }
interface PortalPayment { id: string; studentId: string | null; personId?: string | null; paymentNumber: string; receiptNumber: string | null; methodKind: string; amount: string; refundedAmount: string; currency: string; status: string; paidAt: string; receipts: Array<{ id: string; receiptNumber: string; issueDate: string; status: string }> }
interface PortalReceipt { id: string; receiptNumber: string; issueDate: string; totalAmount: string; currency: string; snapshot: Record<string, unknown>; status: string; paymentId: string; lines: Array<{ id: string; feeTypeName: string; description: string | null; amount: string; allocatedAmount: string }> }
interface PortalInstallment { id: string; label: string; sequence: number; dueDate: string; amount: string; adjustmentAmount: string; paidAmount: string; waivedAmount: string; status: string; outstandingAmount: string; demand: { studentId: string | null; personId?: string | null; demandNumber: string; currency: string } }
interface PortalCredit { id: string; studentId: string | null; personId?: string | null; source: string; currency: string; availableAmount: string; createdAt: string; reason: string | null }
interface PortalMethod { id: string; name: string; kind: string }
interface PortalAttendance { id: string; status: string; remarks: string | null; session: { attendanceDate: string; sessionLabel: string; branch: { name: string } } }
interface PortalDashboard { person?: PortalPerson; students: PortalStudent[]; demands: PortalDemand[]; payments: PortalPayment[]; installments: PortalInstallment[]; credits: PortalCredit[]; paymentMethods: PortalMethod[] }
interface OpenItem { id: string; feeTypeName: string; frequency: string; quantity: string | null; rate: string | null; outstandingAmount: string; demand: { demandNumber: string; financialPeriod: string | null; dueDate: string; currency: string } }
interface CheckoutResult { orderId: string; orderNumber: string; status: string; message?: string; checkout?: CheckoutSession }

export default function PortalPage() {
  const { user } = useSession();
  const [data, setData] = useState<PortalDashboard | null>(null);
  const [studentId, setStudentId] = useState('');
  const [attendance, setAttendance] = useState<PortalAttendance[]>([]);
  const [attendanceNotice, setAttendanceNotice] = useState('');
  const [openItems, setOpenItems] = useState<OpenItem[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<PortalReceipt | null>(null);
  const [receiptLoadingId, setReceiptLoadingId] = useState('');
  const [receiptDownloadId, setReceiptDownloadId] = useState('');
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
    if (data?.person) {
      setStudentId(data.person.id);
      void apiRequest<OpenItem[]>(`/payments/people/${data.person.id}/open-items`).then((items) => { setOpenItems(items); setSelectedItems([]); }).catch((cause) => setError(cause instanceof ApiError ? cause.message : 'Open fee items could not be loaded.'));
      return;
    }
    if (!studentId) { setOpenItems([]); setSelectedItems([]); return; }
    const guardianId = user?.roles.includes('PARENT') ? user.guardianId : null;
    const payerQuery = guardianId ? `?payerType=PARENT&payerGuardianId=${encodeURIComponent(guardianId)}` : '';
    void apiRequest<OpenItem[]>(`/payments/students/${studentId}/open-items${payerQuery}`).then((items) => { setOpenItems(items); setSelectedItems([]); }).catch((cause) => setError(cause instanceof ApiError ? cause.message : 'Open fee items could not be loaded.'));
  }, [data?.person, studentId, user?.guardianId, user?.roles]);

  useEffect(() => {
    if (!data?.person || !user?.roles.includes('WORKSPACE_PERSON')) { setAttendance([]); setAttendanceNotice(''); return; }
    void apiRequest<PortalAttendance[]>('/portal/attendance').then((rows) => { setAttendance(rows); setAttendanceNotice(''); }).catch((cause) => {
      setAttendance([]);
      setAttendanceNotice(cause instanceof ApiError ? cause.message : 'Attendance is not available for this workspace.');
    });
  }, [data?.person, user?.roles]);

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
    const subjectId = data?.person?.id ?? studentId;
    if (!subjectId) return;
    const values = new FormData(event.currentTarget);
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<CheckoutResult>('/gateways/orders', { method: 'POST', body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(), ...(data?.person ? { personId: subjectId } : { studentId: subjectId }), methodId: values.get('methodId'), amount: values.get('amount'),
        demandItemIds: selectedItems.length ? selectedItems : undefined,
        payerType: data?.person ? 'MEMBER' : user?.roles.includes('PARENT') ? 'PARENT' : 'STUDENT',
        payerName: data?.person ? [data.person.preferredName ?? data.person.firstName, data.person.middleName, data.person.lastName].filter(Boolean).join(' ') : [user?.firstName, user?.lastName].filter(Boolean).join(' '),
        payerGuardianId: user?.roles.includes('PARENT') ? user.guardianId : undefined,
      }) });
      if (result.status !== 'INITIATED' || !result.checkout) throw new Error(result.message ?? 'The payment provider could not start checkout.');
      setNotice(`Payment order ${result.orderNumber} was created. Payment is confirmed only after the provider callback.`);
      await launchCheckout(result.checkout, result.orderNumber);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : 'Online checkout could not be started.'); }
    finally { setBusy(false); }
  }

  async function openReceipt(id: string) {
    setReceiptLoadingId(id); setError('');
    try { setSelectedReceipt(await apiRequest<PortalReceipt>(`/portal/receipts/${id}`)); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Receipt details could not be loaded.'); }
    finally { setReceiptLoadingId(''); }
  }

  async function downloadReceipt(id: string, receiptNumber: string) {
    setReceiptDownloadId(id); setError('');
    try {
      const blob = await apiDownload(`/portal/receipts/${id}/download`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `receipt-${receiptNumber.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`; anchor.click(); URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Receipt file could not be downloaded.'); }
    finally { setReceiptDownloadId(''); }
  }

  const studentName = (id: string | null) => { const student = data?.students.find((row) => row.id === id); if (student) return [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' '); const person = data?.person; if (person && person.id === id) return [person.preferredName ?? person.firstName, person.middleName, person.lastName].filter(Boolean).join(' '); return 'Person'; };
  const genericPerson = Boolean(data?.person);
  const accountLabel = data?.person?.typeLabel ?? 'Student';

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">{genericPerson ? `${accountLabel.toUpperCase()} PORTAL` : 'STUDENT AND PARENT PORTAL'}</p><h1>{genericPerson ? 'Your organisation account' : 'Your family account'}</h1><p className="muted">View assigned fees, payment history, receipts{genericPerson ? ', and attendance' : ''} for your account.</p></div><span className="heading-count"><ShieldCheck size={16} /> Private to your account</span></div>
    {notice && <div className="notice notice-info" role="status">{notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    {!data ? <section className="surface-panel"><p className="muted">Loading your fee information…</p></section> : <>
      {genericPerson ? <section className="portal-student-grid" aria-label="Your organisation profile"><article className="surface-panel portal-student-card"><span className="metric-icon blue"><UsersRound size={19} /></span><p>{data.person?.personNumber} · {accountLabel}</p><h2>{studentName(data.person?.id ?? null)}</h2><small>{data.person?.branch?.name ?? 'Organisation member'} · {data.person?.status}</small></article></section> : <>
      {data.students.length > 1 && <label className="portal-student-picker">Student<select value={studentId} onChange={(event) => { setStudentId(event.target.value); setSelectedReceipt(null); }}>{data.students.map((student) => <option key={student.id} value={student.id}>{student.admissionNumber} · {studentName(student.id)}</option>)}</select></label>}
      <section className="portal-student-grid" aria-label="Linked students">{data.students.map((student) => {
        const outstanding = data.demands.filter((demand) => demand.studentId === student.id);
        return <article className="surface-panel portal-student-card" key={student.id}><span className="metric-icon blue"><UsersRound size={19} /></span><p>{student.admissionNumber}</p><h2>{studentName(student.id)}</h2><small>{outstanding.length} open fee demands</small></article>;
      })}</section>
      </>}
      {studentId && <section className="surface-panel portal-checkout-panel"><div className="section-heading section-heading-panel"><div><h2>Pay fees online</h2><p>Choose open items or enter an amount. Only the signed gateway confirmation records a payment.</p></div><CreditCard size={19} /></div>
        {data.paymentMethods.length ? <form className="portal-checkout-form" onSubmit={startCheckout}>
          <label>Payment method<select name="methodId" required defaultValue=""><option value="">Choose method</option>{data.paymentMethods.map((method) => <option key={method.id} value={method.id}>{method.name} · {enumLabel(method.kind)}</option>)}</select></label>
          <label>Amount<input name="amount" required inputMode="decimal" placeholder="0.00" pattern="[0-9]+(\.[0-9]{1,4})?" /></label>
          <div className="portal-open-items"><div className="open-items-heading"><strong>Open fee items · {studentName(studentId)}</strong><span>{selectedItems.length ? `${selectedItems.length} selected` : 'Oldest due first'}</span></div>{openItems.length ? openItems.map((item) => <label className="open-item-row" key={item.id}><input type="checkbox" checked={selectedItems.includes(item.id)} onChange={() => setSelectedItems((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span><strong>{item.feeTypeName}</strong><small>{item.demand.demandNumber} · {financialPeriodLabel(item.demand.financialPeriod)} · due {formatIndianDate(new Date(item.demand.dueDate))}</small>{item.quantity && <small>Quantity {Number(item.quantity).toLocaleString("en-IN")}{item.rate ? ` × ${formatIndianCurrency(item.rate, item.demand.currency)} per unit` : ""} · {enumLabel(item.frequency)}</small>}</span><b>{formatIndianCurrency(item.outstandingAmount, item.demand.currency)}</b></label>) : <p className="muted">No open fee items are available for this account.</p>}</div>
          <div className="payment-submit-row"><span className="muted">The institution’s payment rules and gateway limits still apply.</span><button className="button button-primary" disabled={busy}>{busy ? 'Starting checkout…' : 'Continue to secure checkout'} <ShieldCheck size={15} /></button></div>
        </form> : <div className="empty-state"><h2>Online payment is not available</h2><p>The institution has not enabled an online payment method.</p></div>}
      </section>}
      {genericPerson && <section className="surface-panel portal-data-panel"><div className="section-heading section-heading-panel"><div><h2>Attendance</h2><p>Attendance entries recorded for your organisation profile.</p></div><UsersRound size={18} /></div>{attendance.length ? <div className="table-wrap"><table><thead><tr><th>Date</th><th>Branch</th><th>Session</th><th>Status</th><th>Note</th></tr></thead><tbody>{attendance.map((record) => <tr key={record.id}><td>{formatIndianDate(new Date(record.session.attendanceDate))}</td><td>{record.session.branch.name}</td><td>{enumLabel(record.session.sessionLabel)}</td><td>{enumLabel(record.status)}</td><td>{record.remarks ?? '—'}</td></tr>)}</tbody></table></div> : <p className="muted">{attendanceNotice || 'No attendance records are available yet.'}</p>}</section>}
      <section className="surface-panel portal-data-panel"><div className="section-heading section-heading-panel"><div><h2>Fee demands</h2><p>{genericPerson ? 'Fee demands assigned to your account.' : 'Current and recent balances across linked students.'}</p></div><FileText size={18} /></div>{data.demands.length ? <div className="table-wrap"><table><thead><tr><th>{genericPerson ? accountLabel : 'Student'}</th><th>Demand</th><th>Billing period</th><th>Due date</th><th>Your share due</th><th>Status</th></tr></thead><tbody>{data.demands.map((demand) => <tr key={demand.id}><td>{studentName(demand.studentId ?? demand.personId ?? null)}</td><td><strong className="mono-cell">{demand.demandNumber}</strong></td><td>{financialPeriodLabel(demand.financialPeriod)}</td><td>{formatIndianDate(new Date(demand.dueDate))}</td><td><strong>{formatIndianCurrency(demand.outstandingAmount, demand.currency)}</strong>{demand.overallOutstandingAmount !== demand.outstandingAmount && <small className="table-subtext">Total demand still open {formatIndianCurrency(demand.overallOutstandingAmount, demand.currency)}</small>}<small className="table-subtext">{demand.adjustments.map((row) => `${row.adjustmentNumber} · ${row.amount} · ${row.reason}`).join(' · ')}</small></td><td><span className={`status-pill ${demand.status === 'OVERDUE' ? 'status-red' : 'status-amber'}`}>{enumLabel(demand.status)}</span></td></tr>)}</tbody></table></div> : <p className="muted">No outstanding fee demands.</p>}</section>
      <section className="surface-panel portal-data-panel"><div className="section-heading section-heading-panel"><div><h2>Installments</h2><p>Saved payment schedule balances for your account.</p></div><CircleDollarSign size={18} /></div>{data.installments.length ? <div className="table-wrap"><table><thead><tr><th>{genericPerson ? accountLabel : 'Student'}</th><th>Demand</th><th>Installment</th><th>Due date</th><th>Remaining</th><th>Status</th></tr></thead><tbody>{data.installments.map((row) => <tr key={row.id}><td>{studentName(row.demand.studentId ?? row.demand.personId ?? null)}</td><td>{row.demand.demandNumber}</td><td>{row.sequence}. {row.label}</td><td>{formatIndianDate(new Date(row.dueDate))}</td><td>{formatIndianCurrency(row.outstandingAmount, row.demand.currency)}<small className="table-subtext">Adjustment {row.adjustmentAmount}</small></td><td>{enumLabel(row.status)}</td></tr>)}</tbody></table></div> : <p className="muted">No installment schedules found.</p>}</section>
      <section className="surface-panel portal-data-panel"><div className="section-heading section-heading-panel"><div><h2>Payments and receipts</h2><p>Open or download a receipt for your records.</p></div><ReceiptText size={18} /></div>{data.payments.length ? <div className="table-wrap"><table><thead><tr><th>{genericPerson ? accountLabel : 'Student'}</th><th>Payment</th><th>Date</th><th>Method</th><th>Amount</th><th>Receipt</th></tr></thead><tbody>{data.payments.map((payment) => <tr key={payment.id}><td>{studentName(payment.studentId ?? payment.personId ?? null)}</td><td><strong className="mono-cell">{payment.paymentNumber}</strong></td><td>{formatIndianDate(new Date(payment.paidAt))}</td><td>{enumLabel(payment.methodKind)}</td><td>{formatIndianCurrency(payment.amount, payment.currency)}</td><td>{payment.receipts.length ? <div className="portal-receipt-links">{payment.receipts.map((receipt) => <button className="text-button" key={receipt.id} disabled={receiptLoadingId === receipt.id} onClick={() => void openReceipt(receipt.id)}>{receiptLoadingId === receipt.id ? 'Loading…' : receipt.receiptNumber}</button>)}</div> : payment.receiptNumber ?? '—'}</td></tr>)}</tbody></table></div> : <p className="muted">No confirmed payments yet.</p>}</section>
      {selectedReceipt && <section className="surface-panel portal-data-panel portal-receipt-print"><div className="section-heading section-heading-panel"><div><p className="eyebrow">PAYMENT RECEIPT</p><h2>{selectedReceipt.receiptNumber}</h2><p>Issued {formatIndianDate(new Date(selectedReceipt.issueDate))} · {enumLabel(selectedReceipt.status)}</p></div><div className="portal-receipt-controls"><button className="button button-secondary button-small" disabled={receiptDownloadId === selectedReceipt.id} onClick={() => void downloadReceipt(selectedReceipt.id, selectedReceipt.receiptNumber)}><FileText size={14} /> {receiptDownloadId === selectedReceipt.id ? 'Downloading…' : 'Download PDF'}</button><button className="button button-secondary button-small" onClick={() => window.print()}><Printer size={14} /> Print receipt</button><button className="icon-button" aria-label="Close receipt" onClick={() => setSelectedReceipt(null)}><X size={16} /></button></div></div><PortalReceiptPaper receipt={selectedReceipt} studentName={studentName} /></section>}
      {data.credits.length > 0 && <section className="surface-panel portal-data-panel"><div className="section-heading section-heading-panel"><div><h2>Available credits</h2><p>Unallocated balances held in your account.</p></div></div><div className="portal-credit-list">{data.credits.map((credit) => <div key={credit.id}><span>{studentName(credit.studentId ?? credit.personId ?? null)} · {enumLabel(credit.source)}<small>{credit.reason ?? 'Available balance'}</small></span><strong>{formatIndianCurrency(credit.availableAmount, credit.currency)}</strong></div>)}</div></section>}
    </>}
    <style jsx global>{`@media print { body * { visibility: hidden !important; } .portal-receipt-print, .portal-receipt-print * { visibility: visible !important; } .portal-receipt-print { position: fixed !important; inset: 0 !important; margin: 0 !important; border: 0 !important; box-shadow: none !important; } .portal-receipt-controls { display: none !important; } }`}</style>
  </main>;
}

function PortalReceiptPaper({ receipt, studentName }: { receipt: PortalReceipt; studentName: (id: string) => string }) {
  const snapshot = receipt.snapshot;
  const branding = (snapshot.organization ?? snapshot.institution) as { organizationName?: string; institutionName?: string; legalName?: string | null; addressLine1?: string | null; addressLine2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; country?: string | null; phone?: string | null; email?: string | null; receiptFooter?: string | null } | null | undefined;
  const student = snapshot.student as { id?: string; fullName?: string; admissionNumber?: string } | undefined;
  const payer = snapshot.payer as { name?: string | null; type?: string } | undefined;
  const payment = snapshot.payment as { paymentNumber?: string; method?: string; referenceNumber?: string | null } | undefined;
  return <article className="receipt-paper"><header className="receipt-paper-header"><div><h2>{branding?.organizationName ?? branding?.institutionName ?? branding?.legalName ?? 'Organization'}</h2><p>{[branding?.addressLine1, branding?.addressLine2, branding?.city, branding?.state, branding?.postalCode, branding?.country].filter(Boolean).join(', ')}</p><p>{[branding?.phone, branding?.email].filter(Boolean).join(' · ')}</p></div><div className="receipt-paper-number"><span>Receipt no.</span><strong>{receipt.receiptNumber}</strong><span>{formatIndianDate(new Date(receipt.issueDate))}</span></div></header><div className="receipt-parties"><div><span>Received from</span><strong>{payer?.name || (student?.id ? studentName(student.id) : student?.fullName) || 'Payer'}</strong><small>{payer?.type ?? 'PAYER'}{student?.admissionNumber ? ` · ${student.admissionNumber}` : ''}</small></div><div><span>Payment</span><strong>{payment?.paymentNumber ?? receipt.paymentId}</strong><small>{payment?.method ?? 'Payment'}{payment?.referenceNumber ? ` · ${payment.referenceNumber}` : ''}</small></div></div><table className="receipt-lines-table"><thead><tr><th>Charge</th><th>Description</th><th>Amount</th><th>Applied</th></tr></thead><tbody>{receipt.lines.map((line) => <tr key={line.id}><td>{line.feeTypeName}</td><td>{line.description ?? '—'}</td><td>{formatIndianCurrency(line.amount, receipt.currency)}</td><td>{formatIndianCurrency(line.allocatedAmount, receipt.currency)}</td></tr>)}</tbody><tfoot><tr><th colSpan={2}>Total received</th><th colSpan={2}>{formatIndianCurrency(receipt.totalAmount, receipt.currency)}</th></tr></tfoot></table><p className="receipt-footer-note">{branding?.receiptFooter ?? 'Thank you. Keep this receipt for your records.'}</p></article>;
}

function financialPeriodLabel(value: string | null): string { if (!value) return '—'; const [frequency, start, end] = value.split(':'); return frequency && start && end ? `${enumLabel(frequency)} · ${formatIndianDate(new Date(start))} – ${formatIndianDate(new Date(end))}` : value; }
