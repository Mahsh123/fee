'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { BadgePercent, Check, Plus, ShieldCheck, X } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api';
import { useSession } from '../../components/session-provider';

type InstrumentKind = 'SCHOLARSHIP' | 'DISCOUNT' | 'CONCESSION' | 'WAIVER' | 'SURCHARGE';
interface Page<T> { items: T[]; pagination: { total: number } }
interface FeeType { id: string; name: string; code: string }
interface Student { id: string; firstName: string; lastName: string | null; admissionNumber: string }
interface StudentGroup { id: string; name: string; isDynamic: boolean }
interface Year { id: string; name: string }
interface Instrument { id: string; instrumentType: InstrumentKind; name: string; code: string; kind?: string; reason?: string | null; funder?: string | null; active: boolean; percentage?: string | null; fixedAmount?: string | null; maxAmount?: string | null; feeTypeIds?: string[]; academicYearId?: string | null; effectiveFrom: string; effectiveTo?: string | null; requiresApproval?: boolean; fullWaiver?: boolean; taxable?: boolean; taxPercent?: string | null; mandatory?: boolean; stackingMode?: string; priority?: number }
interface Assignment { id: string; status: string; instrumentType?: string; studentId: string | null; groupId: string | null; reason: string; effectiveFrom: string; effectiveTo: string | null; priority: number; student?: Student | null; scholarship?: Instrument | null; discount?: Instrument | null; concession?: Instrument | null; waiver?: Instrument | null }
interface FeeOverride { id: string; studentId: string; feeTypeId: string; originalAmount: string; overrideAmount: string; reason: string; academicYearId: string | null; effectiveFrom: string; effectiveTo: string | null; status: string; requiresApproval: boolean; student?: Student | null }

const instrumentKinds: InstrumentKind[] = ['SCHOLARSHIP', 'DISCOUNT', 'CONCESSION', 'WAIVER', 'SURCHARGE'];
const assignableKinds: InstrumentKind[] = ['SCHOLARSHIP', 'DISCOUNT', 'CONCESSION', 'WAIVER'];
const today = new Date().toISOString().slice(0, 10);

export default function BenefitsPage() {
  const { user } = useSession();
  const canRead = user?.permissions.includes('benefit.read') ?? false;
  const canConfigure = user?.permissions.includes('benefit.configure') ?? false;
  const canAssign = user?.permissions.includes('benefit.assign') ?? false;
  const canApprove = user?.permissions.includes('benefit.approve') ?? false;
  const canReadOverrides = user?.permissions.includes('override.read') ?? false;
  const canCreateOverride = user?.permissions.includes('override.create') ?? false;
  const canApproveOverride = user?.permissions.includes('override.approve') ?? false;
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [overrides, setOverrides] = useState<FeeOverride[]>([]);
  const [feeTypes, setFeeTypes] = useState<FeeType[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [groups, setGroups] = useState<StudentGroup[]>([]);
  const [years, setYears] = useState<Year[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [instrumentKind, setInstrumentKind] = useState<InstrumentKind>('SCHOLARSHIP');
  const [assignmentKind, setAssignmentKind] = useState<InstrumentKind>('SCHOLARSHIP');
  const [targetKind, setTargetKind] = useState<'STUDENT' | 'GROUP'>('STUDENT');
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [editingInstrument, setEditingInstrument] = useState<Instrument | null>(null);
  const [decisionId, setDecisionId] = useState('');
  const [overrideDecisionId, setOverrideDecisionId] = useState('');

  const load = useCallback(async () => {
    if (!canRead && !canReadOverrides) { setLoading(false); return; }
    setLoading(true);
    try {
      const [instrumentPage, assignmentPage, overridePage] = await Promise.all([
        canRead ? apiRequest<Page<Instrument>>('/benefits/instruments?pageSize=500&sort=name') : Promise.resolve({ items: [], pagination: { total: 0 } }),
        canRead ? apiRequest<Page<Assignment>>('/benefits/assignments?pageSize=200') : Promise.resolve({ items: [], pagination: { total: 0 } }),
        canReadOverrides ? apiRequest<Page<FeeOverride>>('/benefits/overrides?pageSize=200') : Promise.resolve({ items: [], pagination: { total: 0 } }),
      ]);
      setInstruments(instrumentPage.items); setAssignments(assignmentPage.items); setOverrides(overridePage.items); setError('');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Benefit configuration could not be loaded.'); }
    finally { setLoading(false); }
  }, [canRead, canReadOverrides]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!canConfigure && !canAssign && !canCreateOverride) return;
    void Promise.all([
      apiRequest<Page<FeeType>>('/fee-types?pageSize=500&sort=name&status=active').then((page) => setFeeTypes(page.items)).catch(() => undefined),
      canAssign || canCreateOverride ? apiRequest<Page<Student>>('/students?pageSize=500&sort=firstName&status=active').then((page) => setStudents(page.items)).catch(() => undefined) : Promise.resolve(),
      canAssign ? apiRequest<Page<StudentGroup>>('/student-groups?pageSize=500&sort=name&status=active').then((page) => setGroups(page.items)).catch(() => undefined) : Promise.resolve(),
      canAssign ? apiRequest<Page<Year>>('/academic-years?pageSize=200').then((page) => setYears(page.items)).catch(() => undefined) : Promise.resolve(),
    ]);
  }, [canConfigure, canAssign, canCreateOverride]);

  const assignableInstruments = useMemo(() => instruments.filter((item) => item.active && assignableKinds.includes(item.instrumentType) && item.instrumentType === assignmentKind), [instruments, assignmentKind]);

  async function createInstrument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const optional = (key: string) => String(data.get(key) ?? '').trim() || null;
    const feeTypeIds = [...form.querySelectorAll<HTMLSelectElement>('[name="feeTypeIds"] option:checked')].map((option) => option.value);
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = {
        ...(editingInstrument ? {} : { instrumentType: instrumentKind }), name: String(data.get('name')).trim(), code: String(data.get('code')).trim(),
        ...(instrumentKind === 'SCHOLARSHIP' ? { kind: optional('kind') } : {}),
        ...(instrumentKind !== 'SCHOLARSHIP' ? { reason: optional('reason') } : {}),
        funder: optional('funder'), policyId: null,
        percentage: optional('percentage'), fixedAmount: optional('fixedAmount'), maxAmount: optional('maxAmount'), feeTypeIds,
        academicYearId: optional('academicYearId'), effectiveFrom: String(data.get('effectiveFrom')), effectiveTo: optional('effectiveTo'),
        requiresApproval: data.get('requiresApproval') === 'on', fullWaiver: data.get('fullWaiver') === 'on',
        taxable: data.get('taxable') === 'on', taxPercent: optional('taxPercent'), mandatory: data.get('mandatory') === 'on',
        stackingMode: String(data.get('stackingMode') || 'STACKABLE'), priority: Number(data.get('priority') || 100), active: editingInstrument?.active ?? true,
      };
      await apiRequest(editingInstrument ? `/benefits/instruments/${editingInstrument.instrumentType}/${editingInstrument.id}` : '/benefits/instruments', { method: editingInstrument ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      form.reset(); setNotice(`Instrument ${editingInstrument ? 'updated' : 'saved'}. Issued demands keep their original calculation snapshot.`); cancelInstrumentEdit(); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The instrument could not be saved.'); }
    finally { setBusy(false); }
  }

  function editInstrument(instrument: Instrument) {
    setEditingInstrument(instrument);
    setInstrumentKind(instrument.instrumentType);
    setRequiresApproval(instrument.requiresApproval ?? false);
  }

  function cancelInstrumentEdit() {
    setEditingInstrument(null); setInstrumentKind('SCHOLARSHIP'); setRequiresApproval(true);
  }

  async function toggleInstrument(instrument: Instrument) {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/benefits/instruments/${instrument.instrumentType}/${instrument.id}`, { method: 'PATCH', body: JSON.stringify({ active: !instrument.active }) });
      setNotice(`${instrument.name} ${instrument.active ? 'deactivated' : 'activated'}. Past demand snapshots are unchanged.`); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The instrument status could not be changed.'); }
    finally { setBusy(false); }
  }

  async function createAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const optional = (key: string) => String(data.get(key) ?? '').trim() || null;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest('/benefits/assignments', { method: 'POST', body: JSON.stringify({
        instrumentType: assignmentKind, instrumentId: String(data.get('instrumentId')),
        studentId: targetKind === 'STUDENT' ? optional('targetId') : null,
        groupId: targetKind === 'GROUP' ? optional('targetId') : null,
        academicYearId: optional('academicYearId'), effectiveFrom: String(data.get('effectiveFrom')),
        effectiveTo: optional('effectiveTo'), reason: String(data.get('reason')).trim(),
        overridePercentage: optional('overridePercentage'), overrideFixedAmount: optional('overrideFixedAmount'), overrideMaxAmount: optional('overrideMaxAmount'),
        stackingMode: optional('stackingMode') || undefined, priority: optional('priority') ? Number(optional('priority')) : undefined,
      }) });
      form.reset(); setNotice('Benefit assigned. It will be applied to future demands after any required approval.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The benefit could not be assigned.'); }
    finally { setBusy(false); }
  }

  async function createOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const optional = (key: string) => String(data.get(key) ?? '').trim() || null;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest('/benefits/overrides', { method: 'POST', body: JSON.stringify({
        studentId: String(data.get('studentId')), feeTypeId: String(data.get('feeTypeId')),
        originalAmount: String(data.get('originalAmount')), overrideAmount: String(data.get('overrideAmount')),
        reason: String(data.get('reason')).trim(), academicYearId: optional('academicYearId'),
        effectiveFrom: String(data.get('effectiveFrom')), effectiveTo: optional('effectiveTo'),
        requiresApproval: data.get('requiresApproval') === 'on',
      }) });
      form.reset(); setNotice('Fee override saved. It changes only future demands within its approved date window.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The fee override could not be saved.'); }
    finally { setBusy(false); }
  }

  async function decide(event: FormEvent<HTMLFormElement>, assignmentId: string, decision: 'APPROVE' | 'REJECT' | 'ARCHIVE') {
    event.preventDefault(); const form = event.currentTarget; const reason = String(new FormData(form).get('reason') ?? '').trim();
    if (!reason) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/benefits/assignments/${assignmentId}/decision`, { method: 'POST', body: JSON.stringify({ decision, reason }) });
      setNotice(`Assignment ${decision.toLowerCase()}d.`); setDecisionId(''); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The assignment decision could not be saved.'); }
    finally { setBusy(false); }
  }

  async function decideOverride(event: FormEvent<HTMLFormElement>, overrideId: string, decision: 'APPROVE' | 'REJECT' | 'ARCHIVE') {
    event.preventDefault(); const form = event.currentTarget; const reason = String(new FormData(form).get('reason') ?? '').trim();
    if (!reason) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/benefits/overrides/${overrideId}/decision`, { method: 'POST', body: JSON.stringify({ decision, reason }) });
      setNotice(`Override ${decision.toLowerCase()}d.`); setOverrideDecisionId(''); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The override decision could not be saved.'); }
    finally { setBusy(false); }
  }

  if (!canRead && !canReadOverrides && !canConfigure && !canAssign && !canCreateOverride && !canApproveOverride) return <main id="main-content" className="page-content"><section className="empty-state"><span className="empty-icon"><BadgePercent /></span><h1>Benefit access required</h1><p>Your role cannot view scholarship, discount, concession, waiver, surcharge or override configuration.</p></section></main>;

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">FEE CONFIGURATION</p><h1>Benefits and surcharges</h1><p className="muted">Configure tenant-owned relief and additional charges, then assign approved benefits to students or groups.</p></div><span className="heading-count"><BadgePercent size={16} /> {instruments.length} instruments</span></div>
    {notice && <div className="notice notice-success" role="status">{notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}

    {canConfigure && <section className="surface-panel sponsor-create-panel"><div className="section-heading section-heading-panel"><div><h2>{editingInstrument ? `Edit ${editingInstrument.name}` : 'Benefit instrument'}</h2><p>Amounts, eligible fees, dates and approval are institution-configured.</p></div>{editingInstrument ? <button className="button button-secondary button-small" type="button" onClick={cancelInstrumentEdit}>Cancel edit</button> : <Plus size={18} />}</div>
      <form key={editingInstrument?.id ?? 'new-instrument'} className="sponsor-form" onSubmit={createInstrument}>
        <label>Instrument<select value={instrumentKind} disabled={Boolean(editingInstrument)} onChange={(event) => { const kind = event.target.value as InstrumentKind; setInstrumentKind(kind); setRequiresApproval(kind === 'SCHOLARSHIP' || kind === 'CONCESSION' || kind === 'WAIVER'); }}>{instrumentKinds.map((kind) => <option key={kind} value={kind}>{kind.replaceAll('_', ' ')}</option>)}</select></label>
        <label>Name<input name="name" required maxLength={160} defaultValue={editingInstrument?.name ?? ''} /></label>
        <label>Code<input name="code" required maxLength={32} pattern="[A-Za-z0-9_-]+" placeholder="MERIT_AWARD" defaultValue={editingInstrument?.code ?? ''} /></label>
        {instrumentKind === 'SCHOLARSHIP' && <><label>Scholarship type<select name="kind" required defaultValue={editingInstrument?.kind ?? ''}><option value="">Choose type</option>{['FULL', 'PERCENTAGE', 'FIXED_AMOUNT', 'FEE_SPECIFIC', 'TERM_SPECIFIC', 'YEAR_SPECIFIC'].map((kind) => <option key={kind} value={kind}>{kind.replaceAll('_', ' ')}</option>)}</select></label><label>Funding source<input name="funder" maxLength={160} defaultValue={editingInstrument?.funder ?? ''} /></label></>}
        {instrumentKind !== 'SCHOLARSHIP' && <label>Reason / category<input name="reason" required maxLength={500} placeholder="Need-based support" defaultValue={editingInstrument?.reason ?? ''} /></label>}
        {instrumentKind === 'WAIVER' && <label className="inline-check"><input name="fullWaiver" type="checkbox" defaultChecked={editingInstrument?.fullWaiver ?? false} /> Full waiver</label>}
        {!(instrumentKind === 'SCHOLARSHIP' || instrumentKind === 'WAIVER') && <>
          <label>Percentage<input name="percentage" inputMode="decimal" pattern="(?:100(?:\.0{1,6})?|\d{1,2}(?:\.\d{1,6})?|0?\.\d{1,6})" placeholder="Optional" defaultValue={editingInstrument?.percentage ?? ''} /></label>
          <label>Fixed amount<input name="fixedAmount" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,4})?" placeholder="Optional" defaultValue={editingInstrument?.fixedAmount ?? ''} /></label>
        </>}
        {(instrumentKind === 'SCHOLARSHIP' || instrumentKind === 'WAIVER') && <>
          <label>Percentage<input name="percentage" inputMode="decimal" pattern="(?:100(?:\.0{1,6})?|\d{1,2}(?:\.\d{1,6})?|0?\.\d{1,6})" placeholder="Optional" defaultValue={editingInstrument?.percentage ?? ''} /></label>
          <label>Fixed amount<input name="fixedAmount" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,4})?" placeholder="Optional" defaultValue={editingInstrument?.fixedAmount ?? ''} /></label>
        </>}
        <label>Maximum reduction / charge<input name="maxAmount" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,4})?" placeholder="Optional cap" defaultValue={editingInstrument?.maxAmount ?? ''} /></label>
        <label>Eligible fee types<select name="feeTypeIds" multiple size={4} defaultValue={editingInstrument?.feeTypeIds ?? []}>{feeTypes.map((type) => <option key={type.id} value={type.id}>{type.name} ({type.code})</option>)}</select><small>Leave empty to apply to all fee types.</small></label>
        <label>Academic year<select name="academicYearId" defaultValue={editingInstrument?.academicYearId ?? ''}><option value="">All years</option>{years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></label>
        <label>Effective from<input name="effectiveFrom" type="date" defaultValue={editingInstrument?.effectiveFrom.slice(0, 10) ?? today} required /></label>
        <label>Effective to<input name="effectiveTo" type="date" defaultValue={editingInstrument?.effectiveTo?.slice(0, 10) ?? ''} /></label>
        {(instrumentKind === 'DISCOUNT' || instrumentKind === 'SURCHARGE') && <><label>Default stacking<select name="stackingMode" defaultValue={editingInstrument?.stackingMode ?? 'STACKABLE'}>{['STACKABLE', 'NON_STACKABLE', 'EXCLUSIVE', 'HIGHEST_BENEFIT', 'PRIORITY_ONLY'].map((mode) => <option key={mode} value={mode}>{mode.replaceAll('_', ' ')}</option>)}</select></label><label>Default priority<input name="priority" type="number" min="0" max="100000" defaultValue={editingInstrument?.priority ?? 100} /></label></>}
        {instrumentKind !== 'SURCHARGE' && <label className="inline-check"><input name="requiresApproval" type="checkbox" checked={requiresApproval} onChange={(event) => setRequiresApproval(event.target.checked)} /> Assignment needs approval</label>}
        {instrumentKind === 'SURCHARGE' && <><label className="inline-check"><input name="taxable" type="checkbox" defaultChecked={editingInstrument?.taxable ?? false} /> Taxable</label><label>Tax percentage<input name="taxPercent" inputMode="decimal" defaultValue={editingInstrument?.taxPercent ?? ''} /></label><label className="inline-check"><input name="mandatory" type="checkbox" defaultChecked={editingInstrument?.mandatory ?? false} /> Mandatory</label></>}
        <button className="button button-primary sponsor-wide-field" disabled={busy}>{busy ? 'Saving…' : editingInstrument ? 'Update instrument' : 'Save instrument'}</button>
      </form>
    </section>}

    {canAssign && <section className="surface-panel sponsor-create-panel"><div className="section-heading section-heading-panel"><div><h2>Assign a benefit</h2><p>Use a student or group grant for a dated academic period.</p></div><ShieldCheck size={18} /></div>
      <form className="sponsor-form" onSubmit={createAssignment}>
        <label>Benefit type<select value={assignmentKind} onChange={(event) => setAssignmentKind(event.target.value as InstrumentKind)}>{assignableKinds.map((kind) => <option key={kind} value={kind}>{kind.replaceAll('_', ' ')}</option>)}</select></label>
        <label>Instrument<select name="instrumentId" required defaultValue=""><option value="">Choose active instrument</option>{assignableInstruments.map((instrument) => <option key={instrument.id} value={instrument.id}>{instrument.name} ({instrument.code})</option>)}</select></label>
        <label>Assign to<select value={targetKind} onChange={(event) => setTargetKind(event.target.value as 'STUDENT' | 'GROUP')}><option value="STUDENT">One student</option><option value="GROUP">Student group</option></select></label>
        <label>{targetKind === 'STUDENT' ? 'Student' : 'Student group'}<select name="targetId" required defaultValue=""><option value="">Choose {targetKind === 'STUDENT' ? 'student' : 'group'}</option>{targetKind === 'STUDENT' ? students.map((student) => <option key={student.id} value={student.id}>{student.firstName} {student.lastName ?? ''} · {student.admissionNumber}</option>) : groups.map((group) => <option key={group.id} value={group.id}>{group.name} · {group.isDynamic ? 'dynamic' : 'manual'}</option>)}</select></label>
        <label>Academic year<select name="academicYearId" defaultValue=""><option value="">Use instrument period</option>{years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></label>
        <label>Effective from<input name="effectiveFrom" type="date" defaultValue={today} required /></label><label>Effective to<input name="effectiveTo" type="date" /></label>
        <label>Override percentage<input name="overridePercentage" inputMode="decimal" placeholder="Optional" /></label><label>Override fixed amount<input name="overrideFixedAmount" inputMode="decimal" placeholder="Optional" /></label>
        <label>Maximum amount<input name="overrideMaxAmount" inputMode="decimal" placeholder="Optional cap" /></label>
        <label>Stacking<select name="stackingMode" defaultValue=""><option value="">Use instrument setting</option>{['STACKABLE', 'NON_STACKABLE', 'EXCLUSIVE', 'HIGHEST_BENEFIT', 'PRIORITY_ONLY'].map((mode) => <option key={mode} value={mode}>{mode.replaceAll('_', ' ')}</option>)}</select></label>
        <label>Priority override<input name="priority" type="number" min="0" max="100000" placeholder="Use instrument setting" /></label>
        <label className="sponsor-wide-field">Reason<textarea name="reason" required maxLength={1000} rows={2} /></label>
        <button className="button button-primary sponsor-wide-field" disabled={busy || assignableInstruments.length === 0}>{busy ? 'Saving…' : 'Assign benefit'}</button>
      </form>
    </section>}

    {canCreateOverride && <section className="surface-panel sponsor-create-panel"><div className="section-heading section-heading-panel"><div><h2>Student-specific fee override</h2><p>Save the original reference amount, approved price, reason and effective period.</p></div><ShieldCheck size={18} /></div>
      <form className="sponsor-form" onSubmit={createOverride}>
        <label>Student<select name="studentId" required defaultValue=""><option value="">Choose student</option>{students.map((student) => <option key={student.id} value={student.id}>{student.firstName} {student.lastName ?? ''} · {student.admissionNumber}</option>)}</select></label>
        <label>Fee type<select name="feeTypeId" required defaultValue=""><option value="">Choose fee type</option>{feeTypes.map((type) => <option key={type.id} value={type.id}>{type.name} ({type.code})</option>)}</select></label>
        <label>Original amount<input name="originalAmount" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,4})?" placeholder="Current standard amount" /></label>
        <label>Approved amount<input name="overrideAmount" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,4})?" placeholder="May be zero" /></label>
        <label>Academic year<select name="academicYearId" defaultValue=""><option value="">All years</option>{years.map((year) => <option key={year.id} value={year.id}>{year.name}</option>)}</select></label>
        <label>Effective from<input name="effectiveFrom" type="date" defaultValue={today} required /></label><label>Effective to<input name="effectiveTo" type="date" /></label>
        <label className="inline-check"><input name="requiresApproval" type="checkbox" defaultChecked /> Require approval</label>
        <label className="sponsor-wide-field">Reason<textarea name="reason" required maxLength={1000} rows={2} /></label>
        <button className="button button-primary sponsor-wide-field" disabled={busy}>{busy ? 'Saving…' : 'Save fee override'}</button>
      </form>
    </section>}

    {canReadOverrides && <section className="surface-panel sponsor-list-panel"><div className="section-heading section-heading-panel"><div><h2>Fee overrides</h2><p>Approved prices apply to matching fee types for this student and period.</p></div></div>
      {loading ? <div className="compact-empty">Loading fee overrides…</div> : overrides.length ? <div className="table-wrap"><table><thead><tr><th>Student</th><th>Fee type</th><th>Original → approved</th><th>Effective</th><th>Status</th><th></th></tr></thead><tbody>{overrides.map((override) => <tr key={override.id}><td>{override.student ? `${override.student.firstName} ${override.student.lastName ?? ''} · ${override.student.admissionNumber}` : override.studentId}</td><td>{feeTypes.find((type) => type.id === override.feeTypeId)?.name ?? override.feeTypeId}</td><td>{override.originalAmount} → {override.overrideAmount}<small className="table-subtext">{override.reason}</small></td><td>{override.effectiveFrom.slice(0, 10)} – {override.effectiveTo?.slice(0, 10) ?? 'Open'}</td><td><span className={`status-pill ${override.status === 'ACTIVE' ? 'status-green' : override.status === 'PENDING_APPROVAL' ? 'status-amber' : 'status-gray'}`}>{override.status.replaceAll('_', ' ')}</span></td><td>{canApproveOverride && <div className="button-row">{override.status === 'PENDING_APPROVAL' ? <button className="button button-primary button-small" disabled={busy} onClick={() => setOverrideDecisionId(override.id)}><Check size={13} /> Decide</button> : override.status === 'ACTIVE' ? <button className="button button-secondary button-small" disabled={busy} onClick={() => setOverrideDecisionId(override.id)}><X size={13} /> Archive</button> : null}</div>}{overrideDecisionId === override.id && <form className="decision-inline-form" onSubmit={(event) => void decideOverride(event, override.id, override.status === 'PENDING_APPROVAL' ? (new FormData(event.currentTarget).get('decision') as 'APPROVE' | 'REJECT') : 'ARCHIVE')}><label>Decision reason<textarea name="reason" required maxLength={1000} rows={2} /></label>{override.status === 'PENDING_APPROVAL' && <label>Decision<select name="decision"><option value="APPROVE">Approve</option><option value="REJECT">Reject</option></select></label>}<div className="button-row"><button className="button button-primary button-small" disabled={busy}>Save decision</button><button type="button" className="button button-secondary button-small" onClick={() => setOverrideDecisionId('')}>Cancel</button></div></form>}</td></tr>)}</tbody></table></div> : <div className="compact-empty">No fee overrides configured.</div>}
    </section>}

    {canRead && <section className="surface-panel sponsor-list-panel"><div className="section-heading section-heading-panel"><div><h2>Benefit assignments</h2><p>Approval status and effective dates determine future demand calculation.</p></div><BadgePercent size={18} /></div>
      {loading ? <div className="compact-empty">Loading benefits…</div> : assignments.length ? <div className="table-wrap"><table><thead><tr><th>Benefit</th><th>Student / group</th><th>Period</th><th>Priority</th><th>Status</th><th></th></tr></thead><tbody>{assignments.map((assignment) => {
        const instrument = assignment.scholarship ?? assignment.discount ?? assignment.concession ?? assignment.waiver;
        const target = assignment.student ? `${assignment.student.firstName} ${assignment.student.lastName ?? ''} · ${assignment.student.admissionNumber}` : assignment.groupId ? groups.find((group) => group.id === assignment.groupId)?.name ?? 'Student group' : '—';
        return <tr key={assignment.id}><td><strong>{instrument?.name ?? 'Benefit'}</strong><small className="table-subtext">{assignment.reason}</small></td><td>{target}</td><td>{assignment.effectiveFrom.slice(0, 10)} – {assignment.effectiveTo?.slice(0, 10) ?? 'Open'}</td><td>{assignment.priority}</td><td><span className={`status-pill ${assignment.status === 'ACTIVE' ? 'status-green' : assignment.status === 'PENDING_APPROVAL' ? 'status-amber' : 'status-gray'}`}>{assignment.status.replaceAll('_', ' ')}</span></td><td>{canApprove && <div className="button-row">{assignment.status === 'PENDING_APPROVAL' ? <><button className="button button-primary button-small" disabled={busy} onClick={() => setDecisionId(assignment.id)}><Check size={13} /> Decide</button></> : assignment.status === 'ACTIVE' ? <button className="button button-secondary button-small" disabled={busy} onClick={() => setDecisionId(assignment.id)}><X size={13} /> Archive</button> : null}</div>}{decisionId === assignment.id && <form className="decision-inline-form" onSubmit={(event) => void decide(event, assignment.id, assignment.status === 'PENDING_APPROVAL' ? (new FormData(event.currentTarget).get('decision') as 'APPROVE' | 'REJECT') : 'ARCHIVE')}><label>Decision reason<textarea name="reason" required maxLength={1000} rows={2} /></label>{assignment.status === 'PENDING_APPROVAL' && <label>Decision<select name="decision"><option value="APPROVE">Approve</option><option value="REJECT">Reject</option></select></label>}<div className="button-row"><button className="button button-primary button-small" disabled={busy}>Save decision</button><button type="button" className="button button-secondary button-small" onClick={() => setDecisionId('')}>Cancel</button></div></form>}</td></tr>;
      })}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><BadgePercent /></span><h2>No benefit assignments</h2><p>Approved student or group benefits appear here and apply to future fee demands.</p></div>}
    </section>}
    {canRead && <section className="surface-panel sponsor-list-panel"><div className="section-heading section-heading-panel"><div><h2>Configured instruments</h2><p>Tenant-owned instruments are versioned through issued demand snapshots.</p></div></div>{instruments.length ? <div className="table-wrap"><table><thead><tr><th>Instrument</th><th>Type</th><th>Amount</th><th>Effective</th><th>Status</th>{canConfigure && <th></th>}</tr></thead><tbody>{instruments.map((instrument) => <tr key={instrument.id}><td><strong>{instrument.name}</strong><small className="table-subtext">{instrument.code}{instrument.reason ? ` · ${instrument.reason}` : ''}</small></td><td>{instrument.instrumentType.replaceAll('_', ' ')}</td><td>{instrument.percentage ? `${instrument.percentage}%` : instrument.fixedAmount ?? (instrument.instrumentType === 'WAIVER' ? 'Full / partial' : '—')}</td><td>{instrument.effectiveFrom.slice(0, 10)} – {instrument.effectiveTo?.slice(0, 10) ?? 'Open'}</td><td><span className={`status-pill ${instrument.active ? 'status-green' : 'status-gray'}`}>{instrument.active ? 'Active' : 'Inactive'}</span></td>{canConfigure && <td><div className="button-row"><button className="button button-secondary button-small" disabled={busy} onClick={() => editInstrument(instrument)}>Edit</button><button className="button button-secondary button-small" disabled={busy} onClick={() => void toggleInstrument(instrument)}>{instrument.active ? 'Deactivate' : 'Activate'}</button></div></td>}</tr>)}</tbody></table></div> : <p className="compact-empty">No instruments have been configured.</p>}</section>}
  </main>;
}
