'use client';
import { formatIndianCurrency, formatIndianDate } from '../../lib/locale';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { useSession } from '../../components/session-provider';
import { enumLabel } from '@fee/types';
import { Check, CircleDollarSign, RotateCcw } from 'lucide-react';

interface Payment { id: string; paymentNumber: string; amount: string; refundedAmount: string; currency: string; status: string; paidAt: string; studentId: string | null; channel: string; provider: string | null; providerTxnId: string | null }
interface Method { id: string; kind: string; name: string; requiresReference: boolean; requiresInstrument: boolean; active: boolean; enabledForManual: boolean }
interface Refund { id: string; refundNumber: string; paymentId: string; amount: string; currency: string; status: string; reason: string; kind: string; methodKind: string; toCreditBalance: boolean; providerRefundId: string | null; failureReason: string | null; createdAt: string; approvalRequestId: string | null }
interface Page<T> { items: T[]; pagination: { total: number } }

export default function RefundsPage() {
  const { user } = useSession();
  const [payments, setPayments] = useState<Payment[]>([]); const [methods, setMethods] = useState<Method[]>([]); const [refunds, setRefunds] = useState<Refund[]>([]);
  const [selectedPaymentId, setSelectedPaymentId] = useState(''); const [refundKind, setRefundKind] = useState<'MANUAL' | 'GATEWAY'>('MANUAL');
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
    const paymentId = String(values.get('paymentId') ?? ''); const methodId = String(values.get('methodId') ?? ''); const kind = String(values.get('kind') ?? 'MANUAL');
    try {
      const result = await apiRequest<{ refund: Refund; requiresApproval: boolean }>('/refunds', { method: 'POST', body: JSON.stringify({
        idempotencyKey: idempotencyKey || crypto.randomUUID(), paymentId, kind, ...(kind === 'MANUAL' ? { methodId } : {}), amount: values.get('amount'), reason: values.get('reason'),
        ...(kind === 'MANUAL' ? {
          referenceNumber: values.get('referenceNumber') || undefined, instrumentNumber: values.get('instrumentNumber') || undefined,
          bankName: values.get('bankName') || undefined, toCreditBalance: values.get('toCreditBalance') === 'on',
        } : {}),
      }) });
      setNotice(result.requiresApproval ? `Refund ${result.refund.refundNumber} was submitted for approval.` : `Refund ${result.refund.refundNumber} is approved and ready to process.`);
      form.reset(); setIdempotencyKey(''); setSelectedPaymentId(''); setRefundKind('MANUAL'); await load();
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
    try {
      const result = await apiRequest<Refund>(`/refunds/${id}/complete`, { method: 'POST', body: '{}' });
      setNotice(result.status === 'COMPLETED' ? 'Refund confirmed and its allocation reversals were posted to the ledger.' : result.status === 'FAILED' ? 'The provider reported that the refund failed. No local refund accounting was posted.' : result.failureReason === 'PROVIDER_REFUND_SUCCEEDED_ACCOUNTING_PENDING' ? 'The provider confirmed the refund. Local ledger posting is pending and can be finalized below.' : 'The provider has not confirmed completion yet. Do not submit this refund again; reconcile its status with the provider.');
      await load();
    }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Refund could not be processed.'); }
    finally { setBusy(''); }
  }

  async function reconcile(id: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values = new FormData(event.currentTarget); setBusy(id); setError(''); setNotice('');
    const outcome = String(values.get('outcome')) as 'REFUNDED' | 'FAILED';
    try {
      const result = await apiRequest<Refund>(`/refunds/${id}/reconcile`, { method: 'POST', body: JSON.stringify({
        outcome, providerRefundId: String(values.get('providerRefundId') ?? '').trim() || undefined,
        amount: values.get('amount'), currency: values.get('currency'), resolution: values.get('resolution'),
      }) });
      setNotice(result.status === 'COMPLETED' ? 'Provider refund verified and local ledger entries posted.' : result.status === 'FAILED' ? 'Provider failure recorded. No local refund accounting was posted.' : 'Provider success was recorded; finalize the local ledger posting if it did not complete.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Provider refund reconciliation could not be saved.'); }
    finally { setBusy(''); await load(); }
  }

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">FINANCE</p><h1>Refunds</h1><p className="muted">Request, approve, and process partial or full refunds with item-level allocation reversals.</p></div><span className="heading-count"><RotateCcw size={16} /> {refunds.length} refunds</span></div>
    {notice && <div className="notice notice-success" role="status"><Check size={16} /> {notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    {canRequest && <section className="surface-panel refund-request-panel"><div className="section-heading section-heading-panel"><div><h2>Request a refund</h2><p>Gateway refunds are posted only after the provider confirms the returned amount and currency.</p></div><CircleDollarSign size={18} /></div><form className="refund-form" onChange={() => setIdempotencyKey(crypto.randomUUID())} onSubmit={requestRefund}>
      <label>Payment<select name="paymentId" required value={selectedPaymentId} onChange={(event) => { setSelectedPaymentId(event.target.value); setRefundKind('MANUAL'); }}><option value="">Choose a successful payment</option>{payments.map((payment) => <option key={payment.id} value={payment.id}>{payment.paymentNumber} · {formatIndianCurrency(payment.amount, payment.currency)} · {enumLabel(payment.status)}</option>)}</select></label>
      {payments.some((payment) => payment.id === selectedPaymentId && payment.channel === 'ONLINE' && payment.provider && payment.provider !== 'PAYU') && <label>Refund route<select name="kind" value={refundKind} onChange={(event) => setRefundKind(event.target.value as 'MANUAL' | 'GATEWAY')}><option value="MANUAL">Manual refund</option><option value="GATEWAY">Return through {payments.find((payment) => payment.id === selectedPaymentId)?.provider}</option></select></label>}
      {refundKind === 'MANUAL' && <label>Refund method<select name="methodId" required defaultValue=""><option value="">Choose a manual method</option>{methods.filter((method) => method.active && method.enabledForManual).map((method) => <option key={method.id} value={method.id}>{method.name} · {enumLabel(method.kind)}</option>)}</select></label>}
      <label>Amount<input name="amount" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,4})?" placeholder="0.00" /></label>
      {refundKind === 'MANUAL' && <><label>Reference number<input name="referenceNumber" maxLength={120} placeholder="Optional" /></label>
      <label>Instrument number<input name="instrumentNumber" maxLength={120} placeholder="Cheque / DD number" /></label>
      <label>Bank name<input name="bankName" maxLength={120} placeholder="Optional" /></label></>}
      <label className="refund-form-wide">Reason<textarea name="reason" rows={2} required maxLength={1000} placeholder="Explain why the amount is being returned" /></label>
      {refundKind === 'MANUAL' && <label className="check-label refund-form-wide"><input type="checkbox" name="toCreditBalance" /> Return the amount as student credit</label>}
      <div className="refund-form-wide refund-submit-row"><span className="muted">Amounts above the tenant threshold require separate approval. A provider processing result must be reconciled before resubmission.</span><button className="button button-primary" disabled={busy === 'request' || payments.length === 0 || (refundKind === 'MANUAL' && methods.filter((method) => method.active && method.enabledForManual).length === 0)}>{busy === 'request' ? 'Saving…' : 'Submit refund request'}</button></div>
    </form></section>}
    <section className="surface-panel refund-list-panel"><div className="section-heading section-heading-panel"><div><h2>Refund history</h2><p>Refunds are traced to the original payment and demand allocation.</p></div></div>{refunds.length ? <div className="table-wrap"><table><thead><tr><th>Refund</th><th>Payment</th><th>Amount</th><th>Reason</th><th>Requested</th><th>Status</th><th>Action</th></tr></thead><tbody>{refunds.map((refund) => <tr key={refund.id}><td><strong className="mono-cell">{refund.refundNumber}</strong><small className="table-subtext">{refund.kind === 'GATEWAY' ? `Gateway · ${refund.providerRefundId ?? 'provider pending'}${gatewayRefundHint(refund) ? ` · ${gatewayRefundHint(refund)}` : ''}` : `${enumLabel(refund.methodKind)}${refund.toCreditBalance ? ' · Student credit' : ''}`}</small></td><td className="mono-cell">{payments.find((payment) => payment.id === refund.paymentId)?.paymentNumber ?? refund.paymentId.slice(0, 8)}</td><td><strong>{formatIndianCurrency(refund.amount, refund.currency)}</strong></td><td>{refund.reason}</td><td>{formatIndianDate(new Date(refund.createdAt))}</td><td><span className={`status-pill ${refund.status === 'COMPLETED' ? 'status-green' : refund.status === 'FAILED' ? 'status-red' : refund.status === 'PROCESSING' ? 'status-amber' : 'status-gray'}`}>{enumLabel(refund.status)}</span></td><td>{refund.status === 'PENDING_APPROVAL' && canApprove ? <span className="refund-actions"><button className="text-button" disabled={busy === refund.id} onClick={() => void decide(refund.id, true)}>Approve</button><button className="text-button text-danger" disabled={busy === refund.id} onClick={() => void decide(refund.id, false)}>Reject</button></span> : refund.status === 'APPROVED' && canRequest ? <button className="button button-secondary button-small" disabled={busy === refund.id} onClick={() => void complete(refund.id)}>{busy === refund.id ? 'Processing…' : 'Process'}</button> : refund.status === 'PROCESSING' && refund.providerRefundId && refund.failureReason === 'PROVIDER_REFUND_SUCCEEDED_ACCOUNTING_PENDING' && canRequest ? <button className="button button-secondary button-small" disabled={busy === refund.id} onClick={() => void complete(refund.id)}>{busy === refund.id ? 'Posting…' : 'Finalize ledger'}</button> : refund.status === 'PROCESSING' && refund.kind === 'GATEWAY' && canApprove ? <details className="resolve-record"><summary>Reconcile provider</summary><form onSubmit={(event) => void reconcile(refund.id, event)}><select name="outcome" defaultValue="REFUNDED"><option value="REFUNDED">Provider confirms refund</option><option value="FAILED">Provider confirms failure</option></select><input name="providerRefundId" defaultValue={refund.providerRefundId ?? ''} maxLength={160} placeholder="Provider refund ID (required for success)" /><input name="amount" defaultValue={refund.amount} inputMode="decimal" required /><input name="currency" defaultValue={refund.currency} maxLength={3} required /><textarea name="resolution" required minLength={5} maxLength={1000} rows={2} placeholder="Record the provider dashboard check and reconciliation decision" /><button className="button button-secondary button-small" disabled={busy === refund.id}>{busy === refund.id ? 'Saving…' : 'Save reconciliation'}</button></form></details> : <span className="muted">—</span>}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><RotateCcw /></span><h2>No refunds yet</h2><p>Refund requests and their compensating ledger entries will appear here.</p></div>}</section>
  </main>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }

function gatewayRefundHint(refund: Refund): string | null {
  if (refund.failureReason === 'PROVIDER_REFUND_SUCCEEDED_ACCOUNTING_PENDING') return 'provider confirmed; ledger posting pending';
  if (refund.failureReason === 'PROVIDER_REFUND_FAILED') return 'provider reported failure';
  if (refund.failureReason === 'GATEWAY_REFUND_RESULT_MISMATCH') return 'provider amount/currency needs review';
  if (refund.failureReason === 'GATEWAY_REFUND_RESULT_UNKNOWN' || refund.failureReason === 'PROVIDER_RESPONSE_UNKNOWN') return 'provider result needs review';
  if (refund.failureReason) return 'provider result needs review';
  return null;
}
