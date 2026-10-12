'use client';
import { formatIndianCurrency, formatIndianDate, formatIndianDateTime } from '../../lib/locale';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_KINDS, PAYER_TYPES, enumLabel, type PayerType } from '@fee/types';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { useSession } from '../../components/session-provider';
import { launchCheckout } from '../../lib/checkout';
import { Banknote, Check, CircleDollarSign, ReceiptText, Settings2, ShieldCheck } from 'lucide-react';

interface Student { id: string; admissionNumber: string; firstName: string; middleName: string | null; lastName: string | null }
interface PaymentMethod { id: string; kind: string; name: string; code: string; requiresReference: boolean; requiresInstrument: boolean; enabledForManual: boolean; enabledForOnline: boolean; active: boolean }
interface Sponsor { id: string; name: string; code: string; active: boolean }
interface GuardianOption { id: string; firstName: string; lastName: string | null }
interface PayerRuleOption { id: string; payerType: PayerType; payerName: string | null; active: boolean; sponsor?: { name: string; id: string } | null }
interface OpenItem { id: string; feeTypeCode: string; feeTypeName: string; netAmount: string; paidAmount: string; waivedAmount: string; outstandingAmount: string; demand: { id: string; demandNumber: string; dueDate: string; currency: string; status: string }; responsibilities?: Array<{ payerType: PayerType; payerName: string; amount: string; outstandingAmount: string }>; installmentShares?: Array<{ installmentId: string; amount: string; paidAmount: string; installment: { label: string; dueDate: string; sequence: number } }> }
interface Payment { id: string; paymentNumber: string; receiptNumber: string | null; studentId: string | null; methodKind: string; channel: string; isOverpayment: boolean; unallocatedAmount: string; amount: string; currency: string; status: string; paidAt: string; referenceNumber: string | null }
interface OnlineOrder { id: string; orderNumber: string; studentId: string | null; payerType: PayerType; payerName: string | null; payerSponsorId: string | null; amount: string; currency: string; status: string; createdAt: string; expiresAt: string | null; providerStatusAutoCheckAttempts: number; providerStatusCheckedAt: string | null; providerStatusNextCheckAt: string | null; providerStatusRetriesExhausted: boolean; providerStatusAutoCheckSupported: boolean; payments: Array<{ paymentNumber: string; status: string; receiptNumber: string | null }> }
interface Page<T> { items: T[]; pagination: { total: number } }
interface CollectionResult { requiresApproval?: boolean; approvalRequestId?: string; payment?: Payment; receipt?: { id: string; receiptNumber: string } }
interface CheckoutResult { orderId: string; orderNumber: string; status: string; provider: string; message?: string; checkout?: { mode?: string; url?: string; fields?: Record<string, string>; keyId?: string; orderId?: string; amount?: string; currency?: string; paymentSessionId?: string; environment?: string; callbackUrl?: string } }

export default function PaymentsPage() {
  const { user } = useSession();
  const [students, setStudents] = useState<Student[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [guardians, setGuardians] = useState<GuardianOption[]>([]);
  const [onlineGuardians, setOnlineGuardians] = useState<GuardianOption[]>([]);
  const [payerRules, setPayerRules] = useState<PayerRuleOption[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [onlineOrders, setOnlineOrders] = useState<OnlineOrder[]>([]);
  const [openItems, setOpenItems] = useState<OpenItem[]>([]);
  const [onlineStudentId, setOnlineStudentId] = useState('');
  const [onlinePayerType, setOnlinePayerType] = useState<PayerType>('STUDENT');
  const [onlinePayerSponsorId, setOnlinePayerSponsorId] = useState('');
  const [onlinePayerGuardianId, setOnlinePayerGuardianId] = useState('');
  const [onlinePayerName, setOnlinePayerName] = useState('');
  const [onlineOpenItems, setOnlineOpenItems] = useState<OpenItem[]>([]);
  const [onlineSelectedItems, setOnlineSelectedItems] = useState<string[]>([]);
  const [onlineBusy, setOnlineBusy] = useState(false);
  const [statusCheckOrderId, setStatusCheckOrderId] = useState('');
  const [onlineNotice, setOnlineNotice] = useState('');
  const [onlineError, setOnlineError] = useState('');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [studentId, setStudentId] = useState('');
  const [payerType, setPayerType] = useState<PayerType>('STUDENT');
  const [payerSponsorId, setPayerSponsorId] = useState('');
  const [payerGuardianId, setPayerGuardianId] = useState('');
  const [payerName, setPayerName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const canCollect = hasPermission(user, 'payment.collect');
  const canVerifyPayments = hasPermission(user, 'payment.verify');
  const canReadPayments = hasPermission(user, 'payment.read');
  const canReadStudents = hasPermission(user, 'student.read');
  const canConfigure = hasPermission(user, 'tenant.settings.update');
  const canReadSponsors = hasPermission(user, 'sponsor.read');
  const canReadPayerRules = hasPermission(user, 'payer.responsibility.read');

  const load = useCallback(async () => {
    try {
      const [studentPage, methodRows, paymentPage, orders, sponsorPage, payerRuleRows] = await Promise.all([
        canReadStudents ? apiRequest<Page<Student>>('/students?pageSize=200&sort=admissionNumber') : Promise.resolve({ items: [], pagination: { total: 0 } } as Page<Student>),
        canReadPayments ? apiRequest<PaymentMethod[]>('/payment-methods') : Promise.resolve([] as PaymentMethod[]),
        canReadPayments ? apiRequest<Page<Payment>>('/payments?pageSize=100&sort=-paidAt') : Promise.resolve({ items: [], pagination: { total: 0 } } as Page<Payment>),
        canReadPayments ? apiRequest<OnlineOrder[]>('/gateways/orders') : Promise.resolve([] as OnlineOrder[]),
        canReadSponsors ? apiRequest<Page<Sponsor>>('/sponsors?pageSize=200&sort=name') : Promise.resolve({ items: [], pagination: { total: 0 } }),
        canReadPayerRules ? apiRequest<PayerRuleOption[]>('/payer-responsibility-rules') : Promise.resolve([] as PayerRuleOption[]),
      ]);
      setStudents(studentPage.items); setMethods(methodRows); setPayments(paymentPage.items); setOnlineOrders(orders); setSponsors(sponsorPage.items); setPayerRules(payerRuleRows); setError('');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Payment data could not be loaded.'); }
  }, [canReadPayments, canReadStudents, canReadSponsors, canReadPayerRules]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!studentId || !canReadPayerRules) { setGuardians([]); return; }
    void apiRequest<GuardianOption[]>(`/payer-responsibility-rules/guardians?studentId=${encodeURIComponent(studentId)}`).then(setGuardians).catch((cause) => setError(cause instanceof ApiError ? cause.message : 'Linked guardians could not be loaded.'));
  }, [studentId, canReadPayerRules]);
  useEffect(() => {
    if (!onlineStudentId || !canReadPayerRules) { setOnlineGuardians([]); return; }
    void apiRequest<GuardianOption[]>(`/payer-responsibility-rules/guardians?studentId=${encodeURIComponent(onlineStudentId)}`).then(setOnlineGuardians).catch((cause) => setOnlineError(cause instanceof ApiError ? cause.message : 'Linked guardians could not be loaded.'));
  }, [onlineStudentId, canReadPayerRules]);
  useEffect(() => {
    if (!studentId || (payerType === 'SPONSOR' && !payerSponsorId) || (['PARENT', 'GUARDIAN'].includes(payerType) && !payerGuardianId) || (!['STUDENT', 'SPONSOR', 'PARENT', 'GUARDIAN'].includes(payerType) && !payerName.trim())) { setOpenItems([]); setSelectedItems([]); return; }
    const query = new URLSearchParams({ payerType, ...(payerSponsorId ? { payerSponsorId } : {}), ...(payerGuardianId ? { payerGuardianId } : {}), ...(payerName.trim() ? { payerName: payerName.trim() } : {}) });
    void apiRequest<OpenItem[]>(`/payments/students/${studentId}/open-items?${query}`).then((items) => { setOpenItems(items); setSelectedItems([]); }).catch((cause) => setError(cause instanceof ApiError ? cause.message : 'Open fee items could not be loaded.'));
  }, [studentId, payerType, payerSponsorId, payerGuardianId, payerName]);
  useEffect(() => {
    if (!onlineStudentId || (onlinePayerType === 'SPONSOR' && !onlinePayerSponsorId) || (['PARENT', 'GUARDIAN'].includes(onlinePayerType) && !onlinePayerGuardianId) || (!['STUDENT', 'SPONSOR', 'PARENT', 'GUARDIAN'].includes(onlinePayerType) && !onlinePayerName.trim())) { setOnlineOpenItems([]); setOnlineSelectedItems([]); return; }
    const query = new URLSearchParams({ payerType: onlinePayerType, ...(onlinePayerSponsorId ? { payerSponsorId: onlinePayerSponsorId } : {}), ...(onlinePayerGuardianId ? { payerGuardianId: onlinePayerGuardianId } : {}), ...(onlinePayerName.trim() ? { payerName: onlinePayerName.trim() } : {}) });
    void apiRequest<OpenItem[]>(`/payments/students/${onlineStudentId}/open-items?${query}`).then((items) => { setOnlineOpenItems(items); setOnlineSelectedItems([]); }).catch((cause) => setOnlineError(cause instanceof ApiError ? cause.message : 'Open fee items could not be loaded.'));
  }, [onlineStudentId, onlinePayerType, onlinePayerSponsorId, onlinePayerGuardianId, onlinePayerName]);

  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get('payment_order');
    if (!orderId) return;
    let cancelled = false;
    async function refreshOrder() {
      try {
        for (let attempt = 0; attempt < 30 && !cancelled; attempt += 1) {
          const order = await apiRequest<{ orderNumber: string; status: string; payments: Array<{ receiptNumber: string | null }> }>(`/gateways/orders/${orderId}`);
          if (cancelled) return;
          if (order.status === 'SUCCESS') { setOnlineNotice(`Payment ${order.orderNumber} confirmed. Receipt ${order.payments[0]?.receiptNumber ?? 'is being prepared'} is available in Receipts.`); await load(); return; }
          if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(order.status)) { setOnlineError(`Payment ${order.orderNumber} ended with status ${order.status.toLowerCase()}. You can start a new checkout.`); return; }
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
        }
        if (!cancelled) setOnlineNotice('The provider return was received. Confirmation is still pending; the signed provider callback will update the order shortly.');
      } catch (cause) { if (!cancelled) setOnlineError(cause instanceof ApiError ? cause.message : 'Payment status could not be refreshed.'); }
    }
    void refreshOrder();
    return () => { cancelled = true; };
  }, [load]);

  async function verifyOverdueOrder(orderId: string) {
    setStatusCheckOrderId(orderId); setOnlineError(''); setOnlineNotice('');
    try {
      const result = await apiRequest<{ state: string; status: string; reservationHeld: boolean; message?: string }>(`/gateways/orders/${encodeURIComponent(orderId)}/verify-provider-status`, { method: 'POST' });
      if (result.status === 'SUCCESS' && result.state === 'CAPTURED') setOnlineNotice('The provider confirmed payment. The payment, receipt, and ledger are now recorded.');
      else if (result.status === 'RECONCILIATION_REQUIRED' && result.reservationHeld) setOnlineNotice('The provider reports a capture, but its amount or currency cannot be safely posted. The order remains reserved and needs reconciliation.');
      else if (result.status === 'RECONCILIATION_REQUIRED') setOnlineNotice('The capture is recorded as a payment with balanced ledger evidence, held for reconciliation.');
      else if (result.status === 'EXPIRED') setOnlineNotice('The provider confirmed the order is closed. Its payment reservation has been released.');
      else setOnlineNotice(result.message ?? 'The provider has not confirmed that the order is closed. The payment reservation remains held.');
      await load();
    } catch (cause) {
      setOnlineError(cause instanceof ApiError ? cause.message : 'The provider status could not be checked.');
    } finally { setStatusCheckOrderId(''); }
  }

  async function collect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); setBusy('collect'); setError(''); setNotice('');
    const key = idempotencyKey || crypto.randomUUID(); setIdempotencyKey(key);
    try {
      const result = await apiRequest<CollectionResult>('/payments/manual', { method: 'POST', body: JSON.stringify({
        idempotencyKey: key, studentId: values.get('studentId'), methodId: values.get('methodId'), amount: values.get('amount'),
        demandItemIds: selectedItems.length ? selectedItems : undefined, payerType: values.get('payerType'), payerName: values.get('payerName') || undefined,
        payerSponsorId: payerType === 'SPONSOR' ? payerSponsorId : undefined,
        payerGuardianId: ['PARENT', 'GUARDIAN'].includes(payerType) ? payerGuardianId : undefined,
        referenceNumber: values.get('referenceNumber') || undefined, instrumentNumber: values.get('instrumentNumber') || undefined,
        bankName: values.get('bankName') || undefined, remarks: values.get('remarks') || undefined,
      }) });
      if (result.requiresApproval) setNotice(`Partial collection sent for approval (${result.approvalRequestId}). No payment or receipt is posted until it is approved.`);
      else setNotice(`Payment ${result.payment?.paymentNumber ?? ''} collected. Receipt ${result.receipt?.receiptNumber ?? ''} is ready.`);
      form.reset(); setStudentId(''); setPayerType('STUDENT'); setPayerSponsorId(''); setPayerGuardianId(''); setPayerName(''); setOpenItems([]); setSelectedItems([]); setIdempotencyKey(''); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Payment could not be collected.'); }
    finally { setBusy(''); }
  }

  async function createMethod(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); setBusy('method'); setError(''); setNotice('');
    try {
      await apiRequest('/payment-methods', { method: 'POST', body: JSON.stringify({ kind: values.get('kind'), name: values.get('name'), code: values.get('code'), requiresReference: values.get('requiresReference') === 'on', requiresInstrument: values.get('requiresInstrument') === 'on', enabledForManual: values.get('enabledForManual') === 'on', enabledForOnline: values.get('enabledForOnline') === 'on' }) });
      setNotice('Manual payment method added.'); form.reset(); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Payment method could not be saved.'); }
    finally { setBusy(''); }
  }

  async function startOnlineCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setOnlineBusy(true); setOnlineError(''); setOnlineNotice('');
    try {
      const result = await apiRequest<CheckoutResult>('/gateways/orders', { method: 'POST', body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(), studentId: values.get('studentId'), methodId: values.get('methodId'), amount: values.get('amount'),
        demandItemIds: onlineSelectedItems.length ? onlineSelectedItems : undefined,
        payerType: onlinePayerType,
        payerName: values.get('payerName') || undefined,
        payerPhone: values.get('payerPhone') || undefined,
        payerEmail: values.get('payerEmail') || undefined,
        payerSponsorId: onlinePayerType === 'SPONSOR' ? onlinePayerSponsorId : undefined,
        payerGuardianId: ['PARENT', 'GUARDIAN'].includes(onlinePayerType) ? onlinePayerGuardianId : undefined,
      }) });
      if (result.status !== 'INITIATED' || !result.checkout) throw new Error(result.message ?? 'The selected provider could not start checkout.');
      setOnlineNotice(`Payment order ${result.orderNumber} was created. Only a signed provider confirmation can mark it paid.`);
      await launchCheckout(result.checkout, result.orderNumber);
      if (result.checkout.mode !== 'REDIRECT' && result.checkout.mode !== 'FORM_POST') void pollOrder(result.orderId, result.orderNumber);
    } catch (cause) { setOnlineError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : 'Online checkout could not be started.'); }
    finally { setOnlineBusy(false); }
  }

  async function pollOrder(orderId: string, orderNumber: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2000));
      try {
        const order = await apiRequest<{ status: string; payments: Array<{ receiptNumber: string | null }> }>(`/gateways/orders/${orderId}`);
        if (order.status === 'SUCCESS') { setOnlineNotice(`Payment ${orderNumber} confirmed. Receipt ${order.payments[0]?.receiptNumber ?? 'is being prepared'} is available in Receipts.`); await load(); return; }
        if (['FAILED', 'CANCELLED', 'EXPIRED'].includes(order.status)) { setOnlineError(`Payment ${orderNumber} ended with status ${order.status.toLowerCase()}.`); return; }
      } catch { /* A temporary status request failure does not change payment state. */ }
    }
    setOnlineNotice(`Payment ${orderNumber} is awaiting provider confirmation. You can check its status in the online orders list.`);
  }

  function renewKey() { setIdempotencyKey(crypto.randomUUID()); }
  function toggleItem(id: string) { setSelectedItems((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); }

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">FINANCE</p><h1>Payments</h1><p className="muted">Collect manual payments, apply funds to open demand items, and issue an immutable receipt.</p></div><span className="heading-count"><CircleDollarSign size={16} /> {payments.length} recent payments</span></div>
    {notice && <div className="notice notice-success" role="status"><Check size={16} /> {notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}

    <div className="payment-workspace">
      <section className="surface-panel payment-collect-panel">
        <div className="section-heading section-heading-panel"><div><h2>Collect a payment</h2><p>Receivable allocation, credit balance, ledger posting, and receipt are recorded together.</p></div><Banknote size={20} /></div>
        {!canCollect ? <div className="empty-state"><h2>Collection access required</h2><p>Your role does not include manual payment collection.</p></div> : <form className="payment-form" onChange={renewKey} onSubmit={collect}>
          <label>Student<select name="studentId" value={studentId} onChange={(event) => { setStudentId(event.target.value); setPayerGuardianId(''); }} required><option value="">Choose a student</option>{students.map((student) => <option key={student.id} value={student.id}>{student.admissionNumber} · {[student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ')}</option>)}</select></label>
          <label>Payment method<select name="methodId" required><option value="">Choose a method</option>{methods.filter((method) => method.active && method.enabledForManual).map((method) => <option key={method.id} value={method.id}>{method.name} · {enumLabel(method.kind)}</option>)}</select></label>
          <label>Amount<input name="amount" required inputMode="decimal" placeholder="0.00" pattern="[0-9]+(\.[0-9]{1,4})?" /></label>
          <label>Payer type<select name="payerType" value={payerType} onChange={(event) => { setPayerType(event.target.value as PayerType); setPayerSponsorId(''); setPayerGuardianId(''); setPayerName(''); }}>{PAYER_TYPES.filter((type) => type !== 'SPONSOR' || canReadSponsors).map((type) => <option key={type} value={type}>{enumLabel(type)}</option>)}</select></label>
          {payerType === 'SPONSOR' && <label>Sponsor<select name="payerSponsorId" required value={payerSponsorId} onChange={(event) => setPayerSponsorId(event.target.value)}><option value="">Choose sponsor</option>{sponsors.filter((sponsor) => sponsor.active).map((sponsor) => <option key={sponsor.id} value={sponsor.id}>{sponsor.name} · {sponsor.code}</option>)}</select>{!sponsors.some((sponsor) => sponsor.active) && <small>Configure an active sponsor before collecting this payment.</small>}</label>}
          {['PARENT', 'GUARDIAN'].includes(payerType) && <label>Linked guardian<select name="payerGuardianId" required value={payerGuardianId} onChange={(event) => setPayerGuardianId(event.target.value)}><option value="">Choose linked guardian</option>{guardians.map((guardian) => <option key={guardian.id} value={guardian.id}>{[guardian.firstName, guardian.lastName].filter(Boolean).join(' ')}</option>)}</select></label>}
          {payerType !== 'STUDENT' && payerType !== 'SPONSOR' && !['PARENT', 'GUARDIAN'].includes(payerType) && <label>Payer name<input name="payerName" list="manual-payer-names" required maxLength={200} value={payerName} onChange={(event) => setPayerName(event.target.value)} placeholder="Choose or enter the configured name" /><datalist id="manual-payer-names">{[...new Set(payerRules.filter((rule) => rule.active && rule.payerType === payerType && rule.payerName).map((rule) => rule.payerName!))].map((name) => <option key={name} value={name} />)}</datalist></label>}
          <label>Reference number<input name="referenceNumber" maxLength={120} placeholder="UPI / transfer reference" /></label>
          <label>Instrument number<input name="instrumentNumber" maxLength={120} placeholder="Cheque / DD number" /></label>
          <label>Bank name<input name="bankName" maxLength={120} placeholder="Optional" /></label>
          <label className="payment-form-wide">Notes<textarea name="remarks" rows={2} maxLength={1000} placeholder="Collection notes" /></label>
          {studentId && <div className="payment-form-wide open-items-box"><div className="open-items-heading"><strong>Open demand items</strong><span>{selectedItems.length ? `${selectedItems.length} selected` : 'Automatic oldest due first'}</span></div>{openItems.length ? openItems.map((item) => { const next = item.installmentShares?.find((share) => Number(share.amount) > Number(share.paidAmount)); return <label className="open-item-row" key={item.id}><input type="checkbox" checked={selectedItems.includes(item.id)} onChange={() => toggleItem(item.id)} /><span><strong>{item.feeTypeName}</strong><small>{item.demand.demandNumber} · {next ? `${next.installment.label} due ${formatIndianDate(new Date(next.installment.dueDate))}` : `due ${formatIndianDate(new Date(item.demand.dueDate))}`}</small></span><b>{formatIndianCurrency(item.outstandingAmount, item.demand.currency)}</b></label>}) : <p className="muted">No open demand items. Any permitted advance will be held as student credit.</p>}</div>}
          <div className="payment-form-wide payment-submit-row"><span className="muted">{selectedItems.length ? 'Payment applies to selected items; extra funds follow tenant overpayment settings.' : 'Payment applies to oldest open items first.'}</span><button className="button button-primary" disabled={busy === 'collect' || methods.filter((method) => method.active && method.enabledForManual).length === 0}>{busy === 'collect' ? 'Recording…' : 'Collect payment'} <ReceiptText size={15} /></button></div>
        </form>}
      </section>

      {canConfigure && <section className="surface-panel payment-method-panel"><div className="section-heading section-heading-panel"><div><h2>Payment methods</h2><p>Configure the instruments available for counter collection or online checkout.</p></div><Settings2 size={18} /></div>{methods.filter((method) => method.active).map((method) => <div className="payment-method-row" key={method.id}><span><strong>{method.name}</strong><small>{method.code} · {enumLabel(method.kind)}</small></span><span className="method-channel-badges">{method.enabledForManual && <span className="status-pill status-green">Manual</span>}{method.enabledForOnline && <span className="status-pill status-amber">Online</span>}{!method.enabledForManual && !method.enabledForOnline && <span className="status-pill status-gray">Disabled</span>}</span></div>)}<form className="payment-method-form" onSubmit={createMethod}><label>Name<input name="name" required maxLength={120} placeholder="e.g. Main counter cash" /></label><label>Code<input name="code" required maxLength={32} pattern="[A-Za-z0-9_-]+" placeholder="COUNTER_CASH" /></label><label>Instrument type<select name="kind">{PAYMENT_METHOD_KINDS.map((kind) => <option key={kind} value={kind}>{enumLabel(kind)}</option>)}</select></label><label className="check-label"><input type="checkbox" name="requiresReference" /> Requires reference</label><label className="check-label"><input type="checkbox" name="requiresInstrument" /> Requires instrument number</label><label className="check-label"><input type="checkbox" name="enabledForManual" defaultChecked /> Enable manual collection</label><label className="check-label"><input type="checkbox" name="enabledForOnline" /> Enable online checkout</label><button className="button button-secondary" disabled={busy === 'method'}>{busy === 'method' ? 'Saving…' : 'Add method'}</button></form></section>}
    </div>

    {((canCollect && methods.some((method) => method.active && method.enabledForOnline)) || (canReadPayments && onlineOrders.length > 0)) && <section className="surface-panel online-checkout-panel">
      <div className="section-heading section-heading-panel"><div><h2>{canCollect ? 'Online checkout' : 'Online payment orders'}</h2><p>{canCollect ? 'Choose a student and fee items. The gateway confirms payment before a receipt is issued.' : 'Review online payment state and receipts for this institution.'}</p></div><CircleDollarSign size={19} /></div>
      {onlineNotice && <div className="notice notice-info" role="status">{onlineNotice}</div>}{onlineError && <div className="notice notice-error" role="alert">{onlineError}</div>}
      {canCollect && methods.some((method) => method.active && method.enabledForOnline) && <>
      <form className="online-checkout-form" onSubmit={startOnlineCheckout}>
        <label>Student<select name="studentId" value={onlineStudentId} onChange={(event) => { setOnlineStudentId(event.target.value); setOnlinePayerGuardianId(''); }} required><option value="">Choose a student</option>{students.map((student) => <option key={student.id} value={student.id}>{student.admissionNumber} · {[student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ')}</option>)}</select></label>
        <label>Online payment method<select name="methodId" required><option value="">Choose a method</option>{methods.filter((method) => method.active && method.enabledForOnline).map((method) => <option key={method.id} value={method.id}>{method.name} · {enumLabel(method.kind)}</option>)}</select></label>
        <label>Amount<input name="amount" required inputMode="decimal" placeholder="0.00" pattern="[0-9]+(\.[0-9]{1,4})?" /></label>
        <label>Payer type<select name="payerType" value={onlinePayerType} onChange={(event) => { setOnlinePayerType(event.target.value as PayerType); setOnlinePayerSponsorId(''); setOnlinePayerGuardianId(''); setOnlinePayerName(''); }}>{PAYER_TYPES.filter((type) => type !== 'SPONSOR' || canReadSponsors).map((type) => <option key={type} value={type}>{enumLabel(type)}</option>)}</select></label>
        {onlinePayerType === 'SPONSOR' && <label>Sponsor<select name="payerSponsorId" required value={onlinePayerSponsorId} onChange={(event) => setOnlinePayerSponsorId(event.target.value)}><option value="">Choose sponsor</option>{sponsors.filter((sponsor) => sponsor.active).map((sponsor) => <option key={sponsor.id} value={sponsor.id}>{sponsor.name} · {sponsor.code}</option>)}</select>{!sponsors.some((sponsor) => sponsor.active) && <small>Configure an active sponsor before starting checkout.</small>}</label>}
        {['PARENT', 'GUARDIAN'].includes(onlinePayerType) && <label>Linked guardian<select name="payerGuardianId" required value={onlinePayerGuardianId} onChange={(event) => setOnlinePayerGuardianId(event.target.value)}><option value="">Choose linked guardian</option>{onlineGuardians.map((guardian) => <option key={guardian.id} value={guardian.id}>{[guardian.firstName, guardian.lastName].filter(Boolean).join(' ')}</option>)}</select></label>}
        {onlinePayerType !== 'STUDENT' && onlinePayerType !== 'SPONSOR' && !['PARENT', 'GUARDIAN'].includes(onlinePayerType) && <label>Payer name<input name="payerName" list="online-payer-names" required maxLength={200} value={onlinePayerName} onChange={(event) => setOnlinePayerName(event.target.value)} placeholder="Choose or enter the configured name" /><datalist id="online-payer-names">{[...new Set(payerRules.filter((rule) => rule.active && rule.payerType === onlinePayerType && rule.payerName).map((rule) => rule.payerName!))].map((name) => <option key={name} value={name} />)}</datalist></label>}
        <label>Payer phone<input name="payerPhone" maxLength={40} placeholder="Optional" /></label>
        <label>Payer email<input name="payerEmail" type="email" maxLength={254} placeholder="Optional" /></label>
        {onlineStudentId && <div className="online-items-list"><div className="open-items-heading"><strong>Fee items</strong><span>{onlineSelectedItems.length ? `${onlineSelectedItems.length} selected` : 'Oldest due first'}</span></div>{onlineOpenItems.length ? onlineOpenItems.map((item) => { const next = item.installmentShares?.find((share) => Number(share.amount) > Number(share.paidAmount)); return <label className="open-item-row" key={item.id}><input type="checkbox" checked={onlineSelectedItems.includes(item.id)} onChange={() => setOnlineSelectedItems((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /><span><strong>{item.feeTypeName}</strong><small>{item.demand.demandNumber} · {next ? `${next.installment.label} due ${formatIndianDate(new Date(next.installment.dueDate))}` : `due ${formatIndianDate(new Date(item.demand.dueDate))}`}</small></span><b>{formatIndianCurrency(item.outstandingAmount, item.demand.currency)}</b></label>}) : <p className="muted">No open demand items are available for this student.</p>}</div>}
        <div className="payment-submit-row"><span className="muted">Successful collection is recorded only after a verified gateway event.</span><button className="button button-primary" disabled={onlineBusy || methods.filter((method) => method.active && method.enabledForOnline).length === 0}>{onlineBusy ? 'Starting checkout…' : 'Continue to secure checkout'} <ShieldCheck size={15} /></button></div>
      </form>
      </>}
      {canReadPayments && <div className="online-order-history"><div className="open-items-heading"><strong>Recent online orders</strong><span>Provider-confirmed state</span></div>{onlineOrders.length ? <div className="table-wrap"><table><thead><tr><th>Order</th><th>Student</th><th>Payer</th><th>Created</th><th>Amount</th><th>Status</th><th>Receipt</th>{canVerifyPayments && <th>Action</th>}</tr></thead><tbody>{onlineOrders.slice(0, 10).map((order) => { const captured = order.payments.some((payment) => payment.status === 'SUCCESS'); const awaitingClosure = !captured && ['CREATED', 'INITIATED', 'PENDING'].includes(order.status) && Boolean(order.expiresAt && new Date(order.expiresAt) <= new Date()); const displayStatus = captured && order.status !== 'SUCCESS' ? 'CAPTURE_RECORDED_REVIEW' : order.status; return <tr key={order.id}><td><strong className="mono-cell">{order.orderNumber}</strong></td><td>{students.find((student) => student.id === order.studentId)?.admissionNumber ?? '—'}</td><td>{order.payerName || sponsors.find((sponsor) => sponsor.id === order.payerSponsorId)?.name || enumLabel(order.payerType)}</td><td>{formatIndianDate(new Date(order.createdAt))}</td><td><strong>{formatIndianCurrency(order.amount, order.currency)}</strong></td><td><span className={`status-pill ${displayStatus === 'SUCCESS' ? 'status-green' : displayStatus === 'FAILED' ? 'status-red' : 'status-amber'}`}>{displayStatus === 'CAPTURE_RECORDED_REVIEW' ? 'Capture recorded · review' : enumLabel(displayStatus)}</span>{awaitingClosure && <small className="table-subtext">Past local deadline · reservation remains held until provider state is confirmed.</small>}{awaitingClosure && order.providerStatusAutoCheckSupported && !order.providerStatusRetriesExhausted && order.providerStatusNextCheckAt && <small className="table-subtext">Next automatic check after {formatIndianDateTime(new Date(order.providerStatusNextCheckAt))}.</small>}{awaitingClosure && order.providerStatusRetriesExhausted && <small className="table-subtext">Automatic checks paused; the reservation is still held.</small>}</td><td>{order.payments.find((payment) => payment.status === 'SUCCESS')?.receiptNumber ?? '—'}</td>{canVerifyPayments && <td>{awaitingClosure && <button className="button button-secondary button-small" type="button" disabled={Boolean(statusCheckOrderId)} onClick={() => void verifyOverdueOrder(order.id)}>{statusCheckOrderId === order.id ? 'Checking…' : 'Check provider'}</button>}</td>}</tr>; })}</tbody></table></div> : <p className="muted">No online orders have been started for this institution.</p>}</div>}
    </section>}

    {canVerifyPayments && onlineOrders.some((order) => order.providerStatusRetriesExhausted && ["CREATED", "INITIATED", "PENDING"].includes(order.status)) && <div className="notice notice-info" role="status">Automatic provider checks have paused for an overdue order. Its reservation remains held. Use Check provider in the order list or ask your gateway operator to confirm its status.</div>}
    <section className="surface-panel payment-history-panel"><div className="section-heading section-heading-panel"><div><h2>Recent payments</h2><p>Successful payment records are immutable; corrections use refunds or reversals.</p></div></div>{payments.length ? <div className="table-wrap"><table><thead><tr><th>Payment</th><th>Student</th><th>Method</th><th>Date</th><th>Amount</th><th>Receipt</th><th>Status</th></tr></thead><tbody>{payments.map((payment) => { const heldCapture = payment.channel === 'ONLINE' && !payment.isOverpayment && Number(payment.unallocatedAmount) > 0; return <tr key={payment.id}><td><strong className="mono-cell">{payment.paymentNumber}</strong><small className="table-subtext">{payment.referenceNumber ?? 'Manual collection'}</small></td><td>{students.find((student) => student.id === payment.studentId)?.admissionNumber ?? '—'}</td><td>{enumLabel(payment.methodKind)}</td><td>{formatIndianDate(new Date(payment.paidAt))}</td><td><strong>{formatIndianCurrency(payment.amount, payment.currency)}</strong></td><td>{payment.receiptNumber ?? '—'}</td><td><span className={`status-pill ${heldCapture ? 'status-amber' : 'status-green'}`}>{heldCapture ? 'Held for reconciliation' : enumLabel(payment.status)}</span></td></tr>; })}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><ReceiptText /></span><h2>No payments yet</h2><p>Collected payments and their tenant-scoped receipts will appear here.</p></div>}</section>
  </main>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }
