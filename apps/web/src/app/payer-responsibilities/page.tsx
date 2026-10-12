'use client';
import { formatIndianDate } from '../../lib/locale';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { PAYER_TYPES, enumLabel, type PayerType } from '@fee/types';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { useSession } from '../../components/session-provider';
import { Handshake, Plus, ShieldCheck } from 'lucide-react';

interface Page<T> { items: T[] }
interface Option { id: string; name?: string; code?: string; firstName?: string; lastName?: string; admissionNumber?: string; isCurrent?: boolean; active?: boolean }
interface ResponsibilityRule {
  id: string; code: string; name: string; payerType: PayerType; payerName: string | null; payerSponsorId: string | null; payerGuardianId: string | null;
  studentId: string | null; studentGroupId: string | null; academicYearId: string | null; feeTypeId: string | null;
  basis: 'FIXED_PER_FEE_ITEM' | 'PERCENTAGE_OF_REMAINDER'; value: string; priority: number; effectiveFrom: string; effectiveTo: string | null; active: boolean;
  sponsor?: { name: string; code: string } | null; payerGuardian?: { id: string; firstName: string; lastName: string | null } | null; student?: { admissionNumber: string; firstName: string; lastName: string | null } | null;
  studentGroup?: { name: string; code: string } | null; academicYear?: { name: string } | null; feeType?: { name: string; code: string } | null;
}

export default function PayerResponsibilitiesPage() {
  const { user } = useSession();
  const [rules, setRules] = useState<ResponsibilityRule[]>([]);
  const [sponsors, setSponsors] = useState<Option[]>([]);
  const [guardians, setGuardians] = useState<Option[]>([]);
  const [students, setStudents] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [years, setYears] = useState<Option[]>([]);
  const [feeTypes, setFeeTypes] = useState<Option[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [rulePayerType, setRulePayerType] = useState<PayerType>('SPONSOR');
  const canRead = hasPermission(user, 'payer.responsibility.read');
  const canConfigure = hasPermission(user, 'payer.responsibility.configure');
  const canReadSponsors = hasPermission(user, 'sponsor.read');
  const canReadStudents = hasPermission(user, 'student.read');
  const canReadFees = hasPermission(user, 'fee.catalog.read');
  const canReadYears = hasPermission(user, 'tenant.settings.read');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ruleRows, sponsorPage, guardianOptions, studentPage, groupPage, yearPage, feeTypePage] = await Promise.all([
        apiRequest<ResponsibilityRule[]>('/payer-responsibility-rules'),
        canReadSponsors ? apiRequest<Page<Option>>('/sponsors?pageSize=500&sort=name') : Promise.resolve({ items: [] }),
        apiRequest<Option[]>('/payer-responsibility-rules/guardians'),
        canReadStudents ? apiRequest<Page<Option>>('/students?pageSize=500&sort=admissionNumber') : Promise.resolve({ items: [] }),
        canReadStudents ? apiRequest<Page<Option>>('/student-groups?pageSize=500&sort=name') : Promise.resolve({ items: [] }),
        canReadYears ? apiRequest<Page<Option>>('/academic-years?pageSize=200') : Promise.resolve({ items: [] }),
        canReadFees ? apiRequest<Page<Option>>('/fee-types?pageSize=500&sort=name') : Promise.resolve({ items: [] }),
      ]);
      setRules(ruleRows); setSponsors(sponsorPage.items); setGuardians(guardianOptions); setStudents(studentPage.items); setGroups(groupPage.items); setYears(yearPage.items); setFeeTypes(feeTypePage.items); setError('');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Payer responsibility settings could not be loaded.'); }
    finally { setLoading(false); }
  }, [canReadSponsors, canReadStudents, canReadFees, canReadYears]);

  useEffect(() => { if (canRead) void load(); else setLoading(false); }, [canRead, load]);

  async function createRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const payerType = String(values.get('payerType')) as PayerType;
    const target = String(values.get('target'));
    const body = {
      code: String(values.get('code')).trim(), name: String(values.get('name')).trim(), payerType,
      payerName: payerType === 'SPONSOR' ? undefined : String(values.get('payerName') ?? '').trim() || undefined,
      payerSponsorId: payerType === 'SPONSOR' ? String(values.get('payerSponsorId') || '') : undefined,
      payerGuardianId: payerType === 'PARENT' || payerType === 'GUARDIAN' ? String(values.get('payerGuardianId') || '') : undefined,
      studentId: target === 'STUDENT' ? String(values.get('studentId') || '') : undefined,
      studentGroupId: target === 'GROUP' ? String(values.get('studentGroupId') || '') : undefined,
      academicYearId: String(values.get('academicYearId') || '') || undefined,
      feeTypeId: String(values.get('feeTypeId') || '') || undefined,
      basis: String(values.get('basis')), value: String(values.get('value')).trim(), priority: Number(values.get('priority')),
      effectiveFrom: String(values.get('effectiveFrom')), effectiveTo: String(values.get('effectiveTo') || '') || undefined,
    };
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest('/payer-responsibility-rules', { method: 'POST', body: JSON.stringify(body) });
      form.reset(); setRulePayerType('SPONSOR'); setNotice('Payer rule saved. It applies to future fee demands; existing demands retain their saved split.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Payer responsibility rule could not be saved.'); }
    finally { setBusy(false); }
  }

  async function setActive(rule: ResponsibilityRule) {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/payer-responsibility-rules/${rule.id}`, { method: 'PATCH', body: JSON.stringify({ active: !rule.active }) });
      setNotice(`${rule.name} ${rule.active ? 'deactivated' : 'activated'}. Saved demand splits are unchanged.`); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Payer rule could not be updated.'); }
    finally { setBusy(false); }
  }

  if (!canRead) return <main id="main-content" className="page-content"><section className="empty-state"><span className="empty-icon"><ShieldCheck /></span><h1>Payer responsibility access required</h1><p>Your role does not include access to payer rules.</p></section></main>;
  const today = new Date().toISOString().slice(0, 10);
  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">STUDENT / PAYER</p><h1>Payer responsibilities</h1><p className="muted">Set who covers each fee. Contributions stay separate from discounts, waivers, and scholarships.</p></div><span className="heading-count"><Handshake size={16} /> {rules.length} rules</span></div>
    {notice && <div className="notice notice-success" role="status">{notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    {canConfigure && <section className="surface-panel payer-rule-form-panel">
      <div className="section-heading section-heading-panel"><div><h2>Add a responsibility rule</h2><p>Rules run by priority; the student receives any remaining amount. Changes affect future demands only.</p></div><Plus size={18} /></div>
      <form className="payment-form payer-rule-form" onSubmit={createRule}>
        <label>Rule name<input name="name" required maxLength={160} placeholder="Transport sponsor coverage" /></label>
        <label>Code<input name="code" required maxLength={32} pattern="[A-Za-z0-9_-]+" placeholder="SPONSOR_TRANSPORT" /></label>
        <label>Payer type<select name="payerType" value={rulePayerType} onChange={(event) => setRulePayerType(event.target.value as PayerType)}>{PAYER_TYPES.filter((type) => type !== 'STUDENT').map((type) => <option key={type} value={type}>{enumLabel(type)}</option>)}</select></label>
        <label>Sponsor<select name="payerSponsorId" defaultValue=""><option value="">Choose sponsor</option>{sponsors.filter((sponsor) => sponsor.active !== false).map((sponsor) => <option key={sponsor.id} value={sponsor.id}>{sponsor.name} · {sponsor.code}</option>)}</select><small>Required only for Sponsor. For other payer types, enter a payer name.</small></label>
        {(rulePayerType === 'PARENT' || rulePayerType === 'GUARDIAN') && <label className="payer-guardian-field">Linked guardian<select name="payerGuardianId" required defaultValue=""><option value="">Choose guardian</option>{guardians.map((guardian) => <option key={guardian.id} value={guardian.id}>{[guardian.firstName, guardian.lastName].filter(Boolean).join(' ')} · {guardian.id.slice(0, 8)}</option>)}</select><small>Coverage applies only while this guardian is linked to the student.</small></label>}
        {rulePayerType !== 'SPONSOR' && rulePayerType !== 'PARENT' && rulePayerType !== 'GUARDIAN' && <label>Payer name<input name="payerName" required maxLength={160} placeholder="Government scheme or other payer display name…" /></label>}
        <label>Applies to<select name="target" defaultValue="ALL"><option value="ALL">All students</option><option value="GROUP">One student group</option><option value="STUDENT">One student</option></select></label>
        <label>Student group<select name="studentGroupId" defaultValue=""><option value="">Choose group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name} · {group.code}</option>)}</select></label>
        <label>Student<select name="studentId" defaultValue=""><option value="">Choose student</option>{students.map((student) => <option key={student.id} value={student.id}>{student.admissionNumber} · {[student.firstName, student.lastName].filter(Boolean).join(' ')}</option>)}</select></label>
        <label>Academic year<select name="academicYearId" defaultValue=""><option value="">Any academic year</option>{years.map((year) => <option key={year.id} value={year.id}>{year.name}{year.isCurrent ? ' · Current' : ''}</option>)}</select></label>
        <label>Fee type<select name="feeTypeId" defaultValue=""><option value="">All fee types</option>{feeTypes.map((fee) => <option key={fee.id} value={fee.id}>{fee.name} · {fee.code}</option>)}</select></label>
        <label>Share basis<select name="basis"><option value="PERCENTAGE_OF_REMAINDER">Percent of remaining fee</option><option value="FIXED_PER_FEE_ITEM">Fixed amount per fee item</option></select></label>
        <label>Value<input name="value" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,4})?" placeholder="20 or 5000.00" /></label>
        <label>Priority<input name="priority" type="number" min="0" max="100000" defaultValue="100" /><small>Lower numbers are applied first.</small></label>
        <label>Effective from<input name="effectiveFrom" type="date" required defaultValue={today} /></label>
        <label>Effective to (optional)<input name="effectiveTo" type="date" /></label>
        <button className="button button-primary payment-form-wide" disabled={busy}><Plus size={15} /> {busy ? 'Saving…' : 'Save rule'}</button>
      </form>
    </section>}
    <section className="surface-panel payer-rule-list-panel"><div className="section-heading section-heading-panel"><div><h2>Configured rules</h2><p>Issued demand snapshots keep the amount and payer identity used at generation time.</p></div><Handshake size={18} /></div>
      {loading ? <div className="compact-empty">Loading payer rules…</div> : rules.length ? <div className="table-wrap"><table><thead><tr><th>Rule</th><th>Payer</th><th>Scope</th><th>Coverage</th><th>Effective</th><th>Status</th>{canConfigure && <th></th>}</tr></thead><tbody>{rules.map((rule) => <tr key={rule.id}><td><strong>{rule.name}</strong><small className="table-subtext">{rule.code} · Priority {rule.priority}</small></td><td>{rule.sponsor?.name ?? (rule.payerGuardian ? [rule.payerGuardian.firstName, rule.payerGuardian.lastName].filter(Boolean).join(' ') : rule.payerName ?? enumLabel(rule.payerType))}<small className="table-subtext">{enumLabel(rule.payerType)}</small></td><td>{rule.student ? `${rule.student.admissionNumber} · ${rule.student.firstName}` : rule.studentGroup?.name ?? 'All students'}<small className="table-subtext">{[rule.academicYear?.name, rule.feeType?.name].filter(Boolean).join(' · ') || 'All years and fees'}</small></td><td>{rule.basis === 'PERCENTAGE_OF_REMAINDER' ? `${rule.value}% of remainder` : `${rule.value} per fee item`}</td><td>{formatIndianDate(new Date(`${rule.effectiveFrom}T00:00:00`))} – {rule.effectiveTo ? formatIndianDate(new Date(`${rule.effectiveTo}T00:00:00`)) : 'No end date'}</td><td><span className={`status-pill ${rule.active ? 'status-green' : 'status-gray'}`}>{rule.active ? 'Active' : 'Inactive'}</span></td>{canConfigure && <td><button className="button button-secondary button-small" disabled={busy} onClick={() => void setActive(rule)}>{rule.active ? 'Deactivate' : 'Activate'}</button></td>}</tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><Handshake /></span><h2>No payer rules yet</h2><p>Configure a sponsor, government, scholarship fund, parent, or other payer share.</p></div>}
    </section>
  </main>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }
