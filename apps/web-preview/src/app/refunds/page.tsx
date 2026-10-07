'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { useSession } from '../../components/session-provider';
import { enumLabel } from '@fee/types';
import { Check, CircleDollarSign, RotateCcw } from 'lucide-react';

interface Payment { id: string; paymentNumber: string; amount: string; refundedAmount: string; currency: string; status: string; paidAt: string; studentId: string | null }
interface Method { id: string; kind: string; name: string; requiresReference: boolean; requiresInstrument: boolean; active: boolean; enabledForManual: boolean }
interface Refund { id: string; refundNumber: string; paymentId: string; amount: string; currency: string; status: string; reason: string; methodKind: string; toCreditBalance: boolean; createdAt: string; approvalRequestId: string | null }
interface Page<T> { items: T[]; pagination: { total: number } }

export default function RefundsPage() {
  const { user } = useSession();
  const [payments, setPayments] = useState<Payment[]>([]); const [methods, setMethods] = useState<Method[]>([]); const [refunds, setRefunds] = useState<Refund[]>([]);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(''); const [idempotencyKey, setIdempotencyKey] = useState('');
  const canRequest = hasPermission(user, 'payment.refund'); const canApprove = hasPermission(user, 'payment.refund.approve');
  const load = useCallback(async () => {
    try {
      const [paymentPage, methodRows, refundPage] = await Promise.all([
        apiRequest<Page<Payment>>('/payments?pageSize=200&status=SUCCESS,PARTIALLY_REFUNDED&sort=-paidAt'),
        apiRequest<Method[]>('/payment-methods'),
        apiRequest<Page<Refund>>('/refunds?pageSize=200&sort=-createdAt'),
      ]);
      setPayments(paymentPage.items); setMethods(methodRows); setRefunds(refundPage.items); setError('');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Refund records could not be loaded.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function requestRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); setBusy('request'); setError(''); setNotice('');
    const paymentId = String(values.get('paymentId') ?? ''); const methodId = String(values.get('methodId') ?? '');
    try {
      const result = await apiRequest<{ refund: Refund; requiresApproval: boolean }>('/refunds', { method: 'POST', body: JSON.stringify({
        idempotencyKey: idempotencyKey || crypto.randomUUID(), paymentId, methodId, amount: values.get('amount'), reason: values.get('reason'),
        referenceNumber: values.get('referenceNumber') || undefined, instrumentNumber: values.get('instrumentNumber') || undefined,
        bankName: values.get('bankName') || undefined, toCreditBalance: values.get('toCreditBalance') === 'on',
      }) });
      setNotice(result.requiresApproval ? `Refund ${result.refund.refundNumber} was submitted for approval.` : `Refund ${result.refund.refundNumber} is approved and ready to process.`);
      form.reset(); setIdempotencyKey(''); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Refund could not be requested.'); }
    finally { setBusy(''); }
  }

  async function decide(id: string, approved: boolean) {
    setBusy(id); setError(''); setNotice('');
    try { await apiRequest(`/refunds/${id}/decision`, { method: 'POST', body: JSON.stringify({ approved }) }); setNotice(approved ? 'Refund approved.' : 'Refund rejected.'); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Refund decision could not be saved.'); }
    finally { setBusy(''); }
  }

  async function complete(id: string) {
    setBusy(id); setError(''); setNotice('');
    try { await apiRequest(`/refunds/${id}/complete`, { method: 'POST', body: '{}' }); setNotice('Refund processed and its allocation reversals were posted to the ledger.'); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Refund could not be processed.'); }
    finally { setBusy(''); }
  }

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">FINANCE</p><h1>Refunds</h1><p className="muted">Request, approve, and process partial or full refunds with item-level allocation reversals.</p></div><span className="heading-count"><RotateCcw size={16} /> {refunds.length} refunds</span></div>
    {notice && <div className="notice notice-success" role="status"><Check size={16} /> {notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    {canRequest && <section className="surface-panel refund-request-panel"><div className="section-heading section-heading-panel"><div><h2>Request a refund</h2><p>Completed refunds keep the original payment and allocations unchanged.</p></div><CircleDollarSign size={18} /></div><form className="refund-form" onChange={() => setIdempotencyKey(crypto.randomUUID())} onSubmit={requestRefund}>
      <label>Payment<select name="paymentId" required defaultValue=""><option value="">Choose a successful payment</option>{payments.map((payment) => <option key={payment.id} value={payment.id}>{payment.paymentNumber} · {payment.currency} {payment.amount} · {enumLabel(payment.status)}</option>)}</select></label>
      <label>Refund method<select name="methodId" required defaultValue=""><option value="">Choose a manual method</option>{methods.filter((method) => method.active && method.enabledForManual).map((method) => <option key={method.id} value={method.id}>{method.name} · {enumLabel(method.kind)}</option>)}</select></label>
      <label>Amount<input name="amount" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,4})?" placeholder="0.00" /></label>
      <label>Reference number<input name="referenceNumber" maxLength={120} placeholder="Optional" /></label>
      <label>Instrument number<input name="instrumentNumber" maxLength={120} placeholder="Cheque / DD number" /></label>
      <label>Bank name<input name="bankName" maxLength={120} placeholder="Optional" /></label>
      <label className="refund-form-wide">Reason<textarea name="reason" rows={2} required maxLength={1000} placeholder="Explain why the amount is being returned" /></label>
      <label className="check-label refund-form-wide"><input type="checkbox" name="toCreditBalance" /> Return the amount as student credit</label>
      <div className="refund-form-wide refund-submit-row"><span className="muted">Amounts above the tenant threshold require separate approval.</span><button className="button button-primary" disabled={busy === 'request' || payments.length === 0 || methods.filter((method) => method.active && method.enabledForManual).length === 0}>{busy === 'request' ? 'Saving…' : 'Submit refund request'}</button></div>
    </form></section>}
    <section className="surface-panel refund-list-panel"><div className="section-heading section-heading-panel"><div><h2>Refund history</h2><p>Refunds are traced to the original payment and demand allocation.</p></div></div>{refunds.length ? <div className="table-wrap"><table><thead><tr><th>Refund</th><th>Payment</th><th>Amount</th><th>Reason</th><th>Requested</th><th>Status</th><th>Action</th></tr></thead><tbody>{refunds.map((refund) => <tr key={refund.id}><td><strong className="mono-cell">{refund.refundNumber}</strong><small className="table-subtext">{enumLabel(refund.methodKind)}{refund.toCreditBalance ? ' · Student credit' : ''}</small></td><td className="mono-cell">{payments.find((payment) => payment.id === refund.paymentId)?.paymentNumber ?? refund.paymentId.slice(0, 8)}</td><td><strong>{refund.currency} {refund.amount}</strong></td><td>{refund.reason}</td><td>{new Date(refund.createdAt).toLocaleDateString()}</td><td><span className={`status-pill ${refund.status === 'COMPLETED' ? 'status-green' : 'status-gray'}`}>{enumLabel(refund.status)}</span></td><td>{refund.status === 'PENDING_APPROVAL' && canApprove ? <span className="refund-actions"><button className="text-button" disabled={busy === refund.id} onClick={() => void decide(refund.id, true)}>Approve</button><button className="text-button text-danger" disabled={busy === refund.id} onClick={() => void decide(refund.id, false)}>Reject</button></span> : refund.status === 'APPROVED' && canRequest ? <button className="button button-secondary button-small" disabled={busy === refund.id} onClick={() => void complete(refund.id)}>{busy === refund.id ? 'Posting…' : 'Process'}</button> : <span className="muted">—</span>}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><RotateCcw /></span><h2>No refunds yet</h2><p>Refund requests and their compensating ledger entries will appear here.</p></div>}</section>
  </main>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }
