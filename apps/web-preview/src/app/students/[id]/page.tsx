'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, CreditCard, FileText, Plus, ReceiptText, UsersRound, WalletCards } from 'lucide-react';
import { GUARDIAN_RELATIONS } from '@fee/types';
import { ApiError, apiRequest, type SessionUser } from '../../../lib/api';
import { useSession } from '../../../components/session-provider';

interface Student {
  id: string; admissionNumber: string; rollNumber: string | null; firstName: string; middleName: string | null; lastName: string | null;
  dateOfBirth: string | null; gender: string | null; category: string | null; phone: string | null; email: string | null;
  addressLine1: string | null; city: string | null; state: string | null; postalCode: string | null; country: string | null;
  status: string; academicYearId: string | null; primaryUnitId: string | null; admissionType: string | null; scholarshipCategory: string | null;
}
interface Guardian { id: string; firstName: string; lastName: string | null; relation: string; phone: string | null; email: string | null; occupation: string | null; isPrimaryContact: boolean; isPrimaryPayer: boolean }
interface CustomAttribute { key: string; value: string | null; valueType: string }
interface Page<T> { items: T[]; pagination: { total: number } }
interface Demand { id: string; demandNumber: string; status: string; dueDate: string; currency: string; netAmount: string; paidAmount: string; waivedAmount: string }
interface Payment { id: string; paymentNumber: string; receiptNumber: string | null; status: string; amount: string; currency: string; paidAt: string; channel: string }
interface Credit { id: string; status: string; source: string; currency: string; availableAmount: string; originalAmount: string; createdAt: string }
interface Installment { id: string; sequence: number; label: string; dueDate: string; remainingAmount: string; displayStatus: string; demand: { demandNumber: string; currency: string } }
interface InstallmentResponse { installments: Installment[] }

const relationLabel = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

export default function StudentProfilePage() {
  const params = useParams<{ id: string }>();
  const studentId = params.id;
  const { user } = useSession();
  const [student, setStudent] = useState<Student | null>(null);
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [customAttributes, setCustomAttributes] = useState<CustomAttribute[]>([]);
  const [demands, setDemands] = useState<Demand[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [credits, setCredits] = useState<Credit[]>([]);
  const [installments, setInstallments] = useState<Installment[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const canEdit = hasPermission(user, 'student.update');
  const canReadGuardians = hasPermission(user, 'guardian.read');
  const canCreateGuardian = hasPermission(user, 'guardian.create');
  const canReadDemand = hasPermission(user, 'fee.demand.read');
  const canReadPayments = hasPermission(user, 'payment.read');
  const canReadCredits = hasPermission(user, 'credit.read');

  const load = useCallback(async () => {
    if (!studentId) return;
    setError('');
    try {
      const base = await apiRequest<Student>(`/students/${studentId}`);
      setStudent(base);
      const optional: Array<Promise<unknown>> = [
        apiRequest<CustomAttribute[]>(`/students/${studentId}/custom-attributes`),
        canReadGuardians ? apiRequest<Guardian[]>(`/students/${studentId}/guardians`) : Promise.resolve([]),
        canReadDemand ? apiRequest<Page<Demand>>(`/fee-demands?studentId=${studentId}&pageSize=100&sort=-dueDate`) : Promise.resolve({ items: [] }),
        canReadPayments ? apiRequest<Page<Payment>>(`/payments?studentId=${studentId}&pageSize=100&sort=-paidAt`) : Promise.resolve({ items: [] }),
        canReadCredits ? apiRequest<Page<Credit>>(`/credits?studentId=${studentId}&pageSize=100&sort=-createdAt`) : Promise.resolve({ items: [] }),
        canReadDemand ? apiRequest<InstallmentResponse>(`/installments/students/${studentId}`) : Promise.resolve({ installments: [] }),
      ];
      const [customAttributeResult, guardianResult, demandResult, paymentResult, creditResult, installmentResult] = await Promise.allSettled(optional);
      if (customAttributeResult.status === 'fulfilled') setCustomAttributes(customAttributeResult.value as CustomAttribute[]);
      if (guardianResult.status === 'fulfilled') setGuardians(guardianResult.value as Guardian[]);
      if (demandResult.status === 'fulfilled') setDemands((demandResult.value as Page<Demand>).items);
      if (paymentResult.status === 'fulfilled') setPayments((paymentResult.value as Page<Payment>).items);
      if (creditResult.status === 'fulfilled') setCredits((creditResult.value as Page<Credit>).items);
      if (installmentResult.status === 'fulfilled') setInstallments((installmentResult.value as InstallmentResponse).installments);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Student profile could not be loaded.');
    }
  }, [studentId, canReadGuardians, canReadDemand, canReadPayments, canReadCredits]);
  useEffect(() => { void load(); }, [load]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest<Student>(`/students/${studentId}`, { method: 'PATCH', body: JSON.stringify({
        phone: textOrNull(data.get('phone')), email: textOrNull(data.get('email')), addressLine1: textOrNull(data.get('addressLine1')),
        city: textOrNull(data.get('city')), state: textOrNull(data.get('state')), postalCode: textOrNull(data.get('postalCode')), country: textOrNull(data.get('country')),
      }) });
      setEditing(false); setNotice('Student contact details saved.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Student details could not be saved.'); }
    finally { setBusy(false); }
  }

  async function addGuardian(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest<Guardian>(`/students/${studentId}/guardians`, { method: 'POST', body: JSON.stringify({
        firstName: String(data.get('firstName')).trim(), lastName: textOrNull(data.get('lastName')), relation: data.get('relation'),
        phone: textOrNull(data.get('phone')), email: textOrNull(data.get('email')), occupation: textOrNull(data.get('occupation')),
        isPrimaryContact: data.get('isPrimaryContact') === 'on', isPrimaryPayer: data.get('isPrimaryPayer') === 'on',
      }) });
      form.reset(); setNotice('Guardian or payer linked to this student.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Guardian could not be added.'); }
    finally { setBusy(false); }
  }

  async function saveCustomAttribute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const key = String(data.get('key')).trim();
    const attribute: CustomAttribute = { key, value: textOrNull(data.get('value')), valueType: String(data.get('valueType')) };
    const attributes = [...customAttributes.filter((current) => current.key !== key), attribute].sort((left, right) => left.key.localeCompare(right.key));
    setBusy(true); setError(''); setNotice('');
    try {
      const updated = await apiRequest<CustomAttribute[]>(`/students/${studentId}/custom-attributes`, { method: 'PUT', body: JSON.stringify({ attributes }) });
      setCustomAttributes(updated); form.reset(); setNotice('Calculation attribute saved. This value is used for future fee calculations.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Calculation attribute could not be saved.'); }
    finally { setBusy(false); }
  }

  if (!student && !error) return <main id="main-content" className="page-content"><div className="loading-table">Loading student profile…</div></main>;
  if (!student) return <main id="main-content" className="page-content"><Link className="text-link" href="/students"><ArrowLeft size={15} /> Back to students</Link><div className="notice notice-error" role="alert">{error || 'Student was not found.'}</div></main>;

  const fullName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ');
  const outstanding = demands.filter((demand) => ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(demand.status)).length;
  return <main id="main-content" className="page-content">
    <Link className="student-back-link" href="/students"><ArrowLeft size={15} /> All students</Link>
    <div className="page-heading student-profile-heading"><div><p className="eyebrow">STUDENT FINANCIAL PROFILE</p><h1>{fullName}</h1><p className="muted">{student.admissionNumber}{student.rollNumber ? ` · Roll ${student.rollNumber}` : ''}</p></div><span className={`status-pill ${student.status === 'ACTIVE' ? 'status-green' : 'status-gray'}`}>{student.status.replaceAll('_', ' ')}</span></div>
    {notice && <div className="notice notice-success" role="status">{notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    <section className="student-profile-metrics" aria-label="Student finance summary">
      <article><span><ReceiptText size={17} /></span><small>Fee demands</small><strong>{demands.length}</strong></article>
      <article><span><WalletCards size={17} /></span><small>Open demands</small><strong>{outstanding}</strong></article>
      <article><span><CreditCard size={17} /></span><small>Payments</small><strong>{payments.length}</strong></article>
      <article><span><FileText size={17} /></span><small>Available credits</small><strong>{credits.filter((credit) => ['AVAILABLE', 'PARTIALLY_ALLOCATED'].includes(credit.status)).length}</strong></article>
    </section>

    <div className="student-profile-grid">
      <section className="surface-panel student-profile-panel"><div className="section-heading section-heading-panel"><div><h2>Student details</h2><p>Personal and academic information held by the institution.</p></div>{canEdit && <button className="text-button" onClick={() => setEditing((value) => !value)}>{editing ? 'Cancel edit' : 'Edit contacts'}</button>}</div>
        {editing ? <form className="student-contact-form" onSubmit={saveProfile}><label>Phone<input name="phone" type="tel" defaultValue={student.phone ?? ''} maxLength={40} /></label><label>Email<input name="email" type="email" defaultValue={student.email ?? ''} maxLength={254} /></label><label className="wide-field">Address<input name="addressLine1" defaultValue={student.addressLine1 ?? ''} maxLength={200} /></label><label>City<input name="city" defaultValue={student.city ?? ''} maxLength={120} /></label><label>State<input name="state" defaultValue={student.state ?? ''} maxLength={120} /></label><label>Postal code<input name="postalCode" defaultValue={student.postalCode ?? ''} maxLength={32} /></label><label>Country<input name="country" defaultValue={student.country ?? ''} maxLength={120} /></label><div className="student-profile-actions"><span className="muted">Saved changes are added to the audit trail.</span><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save details'}</button></div></form> : <dl className="student-detail-list"><div><dt>Phone</dt><dd>{student.phone || '—'}</dd></div><div><dt>Email</dt><dd>{student.email || '—'}</dd></div><div><dt>Date of birth</dt><dd>{student.dateOfBirth ? new Date(student.dateOfBirth).toLocaleDateString() : '—'}</dd></div><div><dt>Category</dt><dd>{student.category || '—'}</dd></div><div><dt>Admission type</dt><dd>{student.admissionType || '—'}</dd></div><div><dt>Scholarship category</dt><dd>{student.scholarshipCategory || '—'}</dd></div><div className="detail-wide"><dt>Address</dt><dd>{[student.addressLine1, student.city, student.state, student.postalCode, student.country].filter(Boolean).join(', ') || '—'}</dd></div></dl>}
      </section>

      <section className="surface-panel student-profile-panel"><div className="section-heading section-heading-panel"><div><h2>Calculation attributes</h2><p>Configurable student facts that fee rules and usage calculations can reference.</p></div></div>
        {customAttributes.length ? <div className="compact-record-list">{customAttributes.map((attribute) => <article key={attribute.key}><span><strong>{attribute.key}</strong><small>{attribute.valueType}</small></span><span className="compact-record-amount">{attribute.value ?? 'Not set'}</span></article>)}</div> : <div className="student-inline-empty">No custom calculation attributes are saved.</div>}
        {canEdit && <form className="student-guardian-form" onSubmit={saveCustomAttribute}><label>Field key<input name="key" required maxLength={64} pattern="[A-Za-z][A-Za-z0-9_]*" placeholder="mealUnits" /></label><label>Value<input name="value" maxLength={2000} /></label><label>Value type<select name="valueType" defaultValue="NUMBER"><option value="NUMBER">Number</option><option value="STRING">Text</option><option value="BOOLEAN">True / false</option><option value="DATE">Date</option><option value="ENUM">Choice value</option></select></label><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save calculation attribute'}</button></form>}
      </section>

      <section className="surface-panel student-profile-panel"><div className="section-heading section-heading-panel"><div><h2>Guardians and payers</h2><p>Contacts linked to this student, including the primary payer.</p></div><UsersRound size={17} /></div>
        {!canReadGuardians ? <p className="muted">Your role does not have guardian read access.</p> : guardians.length ? <div className="guardian-list">{guardians.map((guardian) => <article className="guardian-card" key={guardian.id}><div className="guardian-avatar">{guardian.firstName[0]?.toUpperCase()}</div><div className="guardian-copy"><strong>{guardian.firstName} {guardian.lastName ?? ''}</strong><small>{relationLabel(guardian.relation)}{guardian.isPrimaryContact ? ' · Primary contact' : ''}</small><small>{guardian.phone || guardian.email || 'No contact details'}</small></div>{guardian.isPrimaryPayer && <span className="status-pill status-blue">Payer</span>}</article>)}</div> : <div className="student-inline-empty">No guardians or payers are linked yet.</div>}
        {canCreateGuardian && <details className="student-add-guardian"><summary className="button button-secondary button-small"><Plus size={14} /> Add guardian or payer</summary><form className="student-guardian-form" onSubmit={addGuardian}><label>First name<input name="firstName" required maxLength={120} /></label><label>Last name<input name="lastName" maxLength={120} /></label><label>Relationship<select name="relation" required>{GUARDIAN_RELATIONS.map((relation) => <option key={relation} value={relation}>{relationLabel(relation)}</option>)}</select></label><label>Phone<input name="phone" type="tel" maxLength={40} /></label><label>Email<input name="email" type="email" maxLength={254} /></label><label>Occupation<input name="occupation" maxLength={120} /></label><label className="check-label"><input type="checkbox" name="isPrimaryContact" /> Primary contact</label><label className="check-label"><input type="checkbox" name="isPrimaryPayer" /> Primary payer for this student</label><button className="button button-primary" disabled={busy}>{busy ? 'Adding…' : 'Save contact'}</button></form></details>}
      </section>
    </div>

    <section className="surface-panel student-finance-panel"><div className="section-heading section-heading-panel"><div><h2>Fee demands</h2><p>Issued charges and their recorded collection totals.</p></div></div>{!canReadDemand ? <p className="muted">Your role does not have fee demand read access.</p> : demands.length ? <div className="table-wrap"><table><thead><tr><th>Demand</th><th>Due date</th><th>Status</th><th>Amount</th><th>Paid</th></tr></thead><tbody>{demands.map((demand) => <tr key={demand.id}><td className="mono-cell">{demand.demandNumber}</td><td>{new Date(demand.dueDate).toLocaleDateString()}</td><td><span className="status-pill status-gray">{demand.status.replaceAll('_', ' ')}</span></td><td>{demand.currency} {demand.netAmount}</td><td>{demand.currency} {demand.paidAmount}</td></tr>)}</tbody></table></div> : <div className="student-inline-empty">No fee demands are recorded.</div>}</section>

    <div className="student-profile-grid student-profile-grid-bottom">
      <section className="surface-panel student-profile-panel"><div className="section-heading section-heading-panel"><div><h2>Payment history</h2><p>Recorded payments and their receipt references.</p></div><ReceiptText size={17} /></div>{!canReadPayments ? <p className="muted">Your role does not have payment read access.</p> : payments.length ? <div className="compact-record-list">{payments.map((payment) => <article key={payment.id}><span><strong>{payment.receiptNumber || payment.paymentNumber}</strong><small>{new Date(payment.paidAt).toLocaleString()} · {payment.channel.replaceAll('_', ' ')}</small></span><span className="compact-record-amount">{payment.currency} {payment.amount}<small>{payment.status}</small></span></article>)}</div> : <div className="student-inline-empty">No payments recorded.</div>}</section>
      <section className="surface-panel student-profile-panel"><div className="section-heading section-heading-panel"><div><h2>Installments and credits</h2><p>Upcoming schedule and remaining student credit.</p></div><CreditCard size={17} /></div>{canReadDemand && installments.length > 0 && <div className="compact-record-list">{installments.slice(0, 8).map((installment) => <article key={installment.id}><span><strong>{installment.label || `Installment ${installment.sequence}`}</strong><small>{installment.demand.demandNumber} · due {new Date(installment.dueDate).toLocaleDateString()}</small></span><span className="compact-record-amount">{installment.demand.currency} {installment.remainingAmount}<small>{installment.displayStatus.replaceAll('_', ' ')}</small></span></article>)}</div>}{canReadCredits && credits.map((credit) => <article className="credit-profile-row" key={credit.id}><span><strong>{credit.source.replaceAll('_', ' ')}</strong><small>{new Date(credit.createdAt).toLocaleDateString()} · {credit.status.replaceAll('_', ' ')}</small></span><span className="compact-record-amount">{credit.currency} {credit.availableAmount}<small>available of {credit.originalAmount}</small></span></article>)}{(!canReadCredits || credits.length === 0) && (!canReadDemand || installments.length === 0) && <div className="student-inline-empty">No installment or available credit records.</div>}</section>
    </div>
  </main>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }
function textOrNull(value: FormDataEntryValue | null): string | null { return String(value ?? '').trim() || null; }
