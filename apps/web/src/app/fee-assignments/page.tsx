'use client';
import { formatIndianDate } from '../../lib/locale';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ASSIGNMENT_TARGET_TYPES, enumLabel, PERMISSIONS } from '@fee/types';
import { ApiError, apiRequest } from '../../lib/api';
import { ArrowRight, CalendarDays, Play, UsersRound, WalletCards, X } from 'lucide-react';
import { useSession } from '../../components/session-provider';

interface Structure { id: string; name: string; code: string }
interface Version { id: string; version: number; status: string; effectiveFrom: string; effectiveTo: string | null }
interface StructureItem { id: string; frequency: string; feeTypeId: string; amount: string; quantity: string | null; percentBase: string | null }
interface StructureDetail extends Structure { versions: Array<Version & { items: StructureItem[] }> }
interface Unit { id: string; name: string; code: string; unitType: string }
interface StudentGroup { id: string; name: string; code: string; isDynamic: boolean }
interface AcademicYear { id: string; name: string; isCurrent: boolean; startDate: string; endDate: string }
interface Branch { id: string; name: string; code: string; status: string }
interface StudentOption { id: string; admissionNumber: string; firstName: string; middleName: string | null; lastName: string | null; branchId: string | null }
interface PersonOption { id: string; personNumber: string; typeLabel: string; firstName: string; middleName: string | null; lastName: string | null; branchId: string | null }
interface PersonGroup { id: string; name: string; code: string; active: boolean; typeKey: string | null; _count: { members: number } }
interface Assignment { id: string; branchId: string | null; feeStructureId: string; feeStructureVersionId: string; targetType: string; targetId: string | null; targetStudentIds?: string[]; targetPersonIds?: string[]; status: string; dueDateOverride: string | null; needsAttention: boolean; generatedAt: string | null; generationSummary: Record<string, unknown> | null }
interface CycleItem { id: string; feeTypeId: string; code: string; name: string; frequency: string; calculationMethod: string; calculationConfig: unknown; amount: string; quantity: string | null; percentBase: string | null; quantityRequired: boolean }
interface CyclePerson { id: string; personNumber: string; typeLabel: string; firstName: string; middleName: string | null; lastName: string | null }
interface CycleInputs { assignmentId: string; branchId: string; people: CyclePerson[]; items: CycleItem[] }
interface CycleRun { id: string; frequency: string; periodStart: string; periodEnd: string; dueDate: string; status: string; summary: Record<string, unknown> | null }
interface InstallmentDraft { label: string; dueDate: string; percentage: string }
interface Page<T> { items: T[]; pagination: { total: number } }

export default function FeeAssignmentsPage() {
  const { user } = useSession();
  const canReadStudents = Boolean(user?.isPlatformAdmin || user?.permissions.includes(PERMISSIONS.STUDENT_READ));
  const canReadPeople = Boolean(user?.isPlatformAdmin || user?.permissions.includes(PERMISSIONS.USER_READ));
  const assignmentTargetTypes = ASSIGNMENT_TARGET_TYPES.filter((type) => type === 'PERSON' ? canReadPeople : canReadStudents);
  const [assignments, setAssignments] = useState<Assignment[]>([]); const [structures, setStructures] = useState<Structure[]>([]); const [units, setUnits] = useState<Unit[]>([]); const [groups, setGroups] = useState<StudentGroup[]>([]); const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]); const [branches, setBranches] = useState<Branch[]>([]);
  const [structure, setStructure] = useState<StructureDetail | null>(null); const [structureId, setStructureId] = useState('');
  const [targetType, setTargetType] = useState('PERSON');
  const [personGroupMode, setPersonGroupMode] = useState(false);
  const [personGroups, setPersonGroups] = useState<PersonGroup[]>([]);
  const [branchId, setBranchId] = useState(''); const [studentSearch, setStudentSearch] = useState(''); const [studentResults, setStudentResults] = useState<StudentOption[]>([]); const [selectedStudents, setSelectedStudents] = useState<StudentOption[]>([]); const [studentLookupBusy, setStudentLookupBusy] = useState(false); const [studentLookupError, setStudentLookupError] = useState('');
  const [personSearch, setPersonSearch] = useState(''); const [personResults, setPersonResults] = useState<PersonOption[]>([]); const [selectedPeople, setSelectedPeople] = useState<PersonOption[]>([]); const [personLookupBusy, setPersonLookupBusy] = useState(false); const [personLookupError, setPersonLookupError] = useState('');
  const [installments, setInstallments] = useState<InstallmentDraft[]>([]);
  const [cycleAssignmentId, setCycleAssignmentId] = useState(''); const [cycleInputs, setCycleInputs] = useState<CycleInputs | null>(null); const [cycleRuns, setCycleRuns] = useState<CycleRun[]>([]);
  const [cycleFrequency, setCycleFrequency] = useState(''); const [periodStart, setPeriodStart] = useState(''); const [periodEnd, setPeriodEnd] = useState(''); const [cycleDueDate, setCycleDueDate] = useState(''); const [cycleQuantities, setCycleQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busyId, setBusyId] = useState('');
  const load = useCallback(async () => {
    try { const [assignmentPage, structurePage, branchPage, unitPage, groupPage, yearPage, peopleGroupList] = await Promise.all([
      apiRequest<Page<Assignment>>('/fee-assignments?pageSize=100'),
      apiRequest<Page<Structure>>('/fee-structures?pageSize=100'),
      apiRequest<Page<Branch>>('/organization/branches?pageSize=200'),
      canReadStudents ? apiRequest<Page<Unit>>('/academic-units?pageSize=200').catch(() => ({ items: [] as Unit[] })) : Promise.resolve({ items: [] as Unit[] }),
      canReadStudents ? apiRequest<Page<StudentGroup>>('/student-groups?pageSize=200').catch(() => ({ items: [] as StudentGroup[] })) : Promise.resolve({ items: [] as StudentGroup[] }),
      canReadStudents ? apiRequest<Page<AcademicYear>>('/academic-years?pageSize=200&sort=-startDate').catch(() => ({ items: [] as AcademicYear[] })) : Promise.resolve({ items: [] as AcademicYear[] }),
      canReadPeople ? apiRequest<PersonGroup[]>('/people/groups').catch(() => [] as PersonGroup[]) : Promise.resolve([] as PersonGroup[]),
    ]); setAssignments(assignmentPage.items); setStructures(structurePage.items); setUnits(unitPage.items); setGroups(groupPage.items); setAcademicYears(yearPage.items); setPersonGroups(peopleGroupList); setBranches(branchPage.items.filter((branch) => branch.status === 'ACTIVE')); setError(''); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Assignments could not be loaded.'); }
  }, [canReadPeople, canReadStudents]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (targetType === 'PERSON' && !canReadPeople && canReadStudents) setTargetType('STUDENT'); }, [canReadPeople, canReadStudents, targetType]);
  useEffect(() => { if (!branchId && branches.length === 1) setBranchId(branches[0]!.id); }, [branchId, branches]);
  useEffect(() => {
    if (!structureId) { setStructure(null); return; }
    void apiRequest<StructureDetail>(`/fee-structures/${structureId}`).then(setStructure).catch((cause) => setError(cause instanceof ApiError ? cause.message : 'Schedule versions could not be loaded.'));
  }, [structureId]);
  useEffect(() => {
    if (targetType !== 'STUDENT' || studentSearch.trim().length < 2) { setStudentResults([]); setStudentLookupError(''); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setStudentLookupBusy(true); setStudentLookupError('');
      try {
        const page = await apiRequest<Page<StudentOption>>(`/students?pageSize=50&status=ACTIVE&branchId=${encodeURIComponent(branchId)}&search=${encodeURIComponent(studentSearch.trim())}`);
        if (!cancelled) setStudentResults(page.items.filter((student) => student.branchId === branchId));
      } catch (cause) { if (!cancelled) setStudentLookupError(cause instanceof ApiError ? cause.message : 'Students could not be searched.'); }
      finally { if (!cancelled) setStudentLookupBusy(false); }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [branchId, studentSearch, targetType]);
  useEffect(() => {
    if (targetType !== 'PERSON' || personSearch.trim().length < 2) { setPersonResults([]); setPersonLookupError(''); return; }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setPersonLookupBusy(true); setPersonLookupError('');
      try {
        const page = await apiRequest<Page<PersonOption>>(`/people?pageSize=50&status=ACTIVE&branchId=${encodeURIComponent(branchId)}&search=${encodeURIComponent(personSearch.trim())}`);
        if (!cancelled) setPersonResults(page.items.filter((person) => person.branchId === branchId));
      } catch (cause) { if (!cancelled) setPersonLookupError(cause instanceof ApiError ? cause.message : 'People could not be searched.'); }
      finally { if (!cancelled) setPersonLookupBusy(false); }
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [branchId, personSearch, targetType]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); setError(''); setBusyId('create');
    try {
      const installmentRule = installments.length ? { basis: 'PERCENTAGE', installments } : null;
      await apiRequest('/fee-assignments', { method: 'POST', body: JSON.stringify({ branchId: values.get('branchId'), feeStructureId: values.get('structureId'), feeStructureVersionId: values.get('versionId'), targetType: values.get('targetType'), targetId: targetType === 'STUDENT' ? null : values.get('targetId') || null, ...(targetType === 'STUDENT' ? { targetStudentIds: selectedStudents.map((student) => student.id) } : {}), ...(targetType === 'PERSON' ? { targetPersonIds: selectedPeople.map((person) => person.id) } : {}), academicYearId: targetType === 'PERSON' ? null : values.get('academicYearId') || null, dueDateOverride: values.get('dueDateOverride'), installmentRule }) });
      form.reset(); setInstallments([]); setStructureId(''); setStructure(null); setTargetType(canReadPeople ? 'PERSON' : 'STUDENT'); setPersonGroupMode(false); setBranchId(''); setStudentSearch(''); setStudentResults([]); setSelectedStudents([]); setPersonSearch(''); setPersonResults([]); setSelectedPeople([]); setNotice('Assignment created as a draft. Generate demands after confirming its fee and installment dates.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Assignment could not be created.'); }
    finally { setBusyId(''); }
  }

  function resizeInstallments(count: number) {
    if (count <= 0) { setInstallments([]); return; }
    const shareUnits = Math.floor(100_000_000 / count); const extraUnits = 100_000_000 % count;
    setInstallments(Array.from({ length: count }, (_, index) => ({
      label: installments[index]?.label ?? `Installment ${index + 1}`,
      dueDate: installments[index]?.dueDate ?? '',
      percentage: formatPercentage(shareUnits + (index < extraUnits ? 1 : 0)),
    })));
  }

  function updateInstallment(index: number, field: keyof InstallmentDraft, value: string) {
    setInstallments((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  async function generate(id: string) {
    setBusyId(id); setError(''); setNotice('');
    try { const result = await apiRequest<Record<string, unknown>>(`/fee-assignments/${id}/generate`, { method: 'POST', body: '{}' }); setNotice(`Generation finished: ${String(result.demandsCreated ?? 0)} demand(s) created, ${String(result.demandsSkipped ?? 0)} skipped. Open Fee Demands to review the calculated snapshots.`); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Demand generation could not be completed.'); }
    finally { setBusyId(''); }
  }

  async function openCycle(assignmentId: string) {
    setBusyId(`cycle-open:${assignmentId}`); setError(''); setNotice('');
    try {
      const [inputs, runs] = await Promise.all([
        apiRequest<CycleInputs>(`/fee-assignments/${assignmentId}/generation-inputs`),
        apiRequest<CycleRun[]>(`/fee-assignments/${assignmentId}/cycles`),
      ]);
      setCycleInputs(inputs); setCycleRuns(runs); setCycleAssignmentId(assignmentId);
      const available = [...new Set(inputs.items.map((item) => item.frequency).filter((frequency) => ['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'TERM', 'SEMESTER'].includes(frequency)))].filter((frequency) => frequency !== 'ONE_TIME' || !runs.some((row) => row.frequency === 'ONE_TIME'));
      const frequency = available[0] ?? '';
      setCycleFrequency(frequency);
      const latest = runs.filter((row) => row.frequency === frequency).sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0];
      const start = latest ? addDays(latest.periodEnd.slice(0, 10), 1) : firstDayOfCurrentMonth();
      const end = cycleEndDate(start, frequency);
      setPeriodStart(start); setPeriodEnd(end); setCycleDueDate(addDays(start, 14));
      setCycleQuantities(Object.fromEntries(inputs.people.flatMap((person) => inputs.items.filter((item) => item.frequency === frequency && item.quantityRequired).map((item) => [`${person.id}:${item.id}`, '']))));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Cycle inputs could not be loaded.'); }
    finally { setBusyId(''); }
  }

  function changeCycleFrequency(frequency: string) {
    setCycleFrequency(frequency);
    const latest = cycleRuns.filter((row) => row.frequency === frequency).sort((a, b) => b.periodStart.localeCompare(a.periodStart))[0];
    const start = latest ? addDays(latest.periodEnd.slice(0, 10), 1) : firstDayOfCurrentMonth();
    setPeriodStart(start); setPeriodEnd(cycleEndDate(start, frequency)); setCycleDueDate(addDays(start, 14));
    setCycleQuantities(Object.fromEntries((cycleInputs?.people ?? []).flatMap((person) => (cycleInputs?.items ?? []).filter((item) => item.frequency === frequency && item.quantityRequired).map((item) => [`${person.id}:${item.id}`, '']))));
  }

  async function generateCycle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!cycleInputs) return;
    const cycleItems = cycleInputs.items.filter((item) => item.frequency === cycleFrequency);
    const usageInputs = cycleInputs.people.flatMap((person) => cycleItems.filter((item) => item.quantityRequired).map((item) => ({ personId: person.id, feeStructureItemId: item.id, quantity: cycleQuantities[`${person.id}:${item.id}`] ?? '' })));
    if (usageInputs.some((row) => !row.quantity.trim())) { setError('Enter every usage/formula quantity before generating this cycle.'); return; }
    setBusyId(`${cycleAssignmentId}:cycle`); setError(''); setNotice('');
    try {
      const result = await apiRequest<Record<string, unknown>>(`/fee-assignments/${cycleAssignmentId}/cycles`, { method: 'POST', body: JSON.stringify({ frequency: cycleFrequency, periodStart, periodEnd, dueDate: cycleDueDate, usageInputs }) });
      const message = `Cycle ${String(result.status ?? 'COMPLETED').toLowerCase()}: ${String(result.demandsCreated ?? 0)} demand(s) created, ${String(result.demandsSkipped ?? 0)} already created${Number(result.peopleNeedingAttention ?? 0) ? `, ${String(result.peopleNeedingAttention)} need attention` : ''}.`;
      setNotice(message);
      const [runs] = await Promise.all([apiRequest<CycleRun[]>(`/fee-assignments/${cycleAssignmentId}/cycles`), load()]);
      setCycleRuns(runs);
      if (result.status === 'COMPLETED') setCycleAssignmentId('');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The billing cycle could not be generated.'); }
    finally { setBusyId(''); }
  }

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">FEE OPERATIONS</p><h1>Assignments</h1><p className="muted">Assign a published fee schedule to a branch, a configured group, or selected organisation members.</p></div><span className="heading-count"><UsersRound size={16} /> {assignments.length} assignments</span></div>
    {notice && <div className="notice notice-success" role="status">{notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    <section className="surface-panel assignment-create-panel"><div className="section-heading section-heading-panel"><div><h2>New assignment</h2><p>Only published fee structure versions can be assigned to one selected branch.</p></div></div><form className="assignment-form" onSubmit={create}>
      <label>Branch<select name="branchId" required value={branchId} onChange={(event) => { setBranchId(event.target.value); setSelectedStudents([]); }}><option value="">Choose a branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} · {branch.code}</option>)}</select></label>
      <label>Fee structure<select name="structureId" value={structureId} onChange={(e) => setStructureId(e.target.value)} required><option value="">Choose a schedule</option>{structures.map((row) => <option key={row.id} value={row.id}>{row.name} ({row.code})</option>)}</select></label>
      <label>Published version<select name="versionId" required disabled={!structure}><option value="">Choose version</option>{structure?.versions.filter((v) => v.status === 'ACTIVE').map((v) => <option key={v.id} value={v.id}>Version {v.version} · from {formatIndianDate(new Date(v.effectiveFrom))}</option>)}</select></label>
      <label>Assign to<select name="targetType" value={targetType} onChange={(event) => { setTargetType(event.target.value); setSelectedStudents([]); setStudentSearch(''); setSelectedPeople([]); setPersonSearch(''); setPersonGroupMode(false); }} required>{assignmentTargetTypes.map((type) => <option key={type} value={type}>{type === 'STUDENT' ? 'Education students' : type === 'PERSON' ? 'Organisation people' : type === 'CUSTOM_GROUP' ? 'Education student group' : enumLabel(type)}</option>)}</select></label>
      {targetType === 'STUDENT' ? <div className="student-assignment-picker">
        <label>Find people<input type="search" value={studentSearch} onChange={(event) => setStudentSearch(event.target.value)} placeholder="Search by name, admission number, or email" disabled={!branchId} /></label>
        <small className="field-hint">Choose active people from the selected branch. A fee demand will be created for each selected person.</small>
        {!branchId && <p className="muted">Choose a branch before searching.</p>}
        {studentSearch.trim().length > 0 && studentSearch.trim().length < 2 && <p className="muted">Type at least 2 characters to search.</p>}
        {studentLookupBusy && <p className="muted" role="status">Searching people…</p>}
        {studentLookupError && <p className="notice notice-error" role="alert">{studentLookupError}</p>}
        {studentSearch.trim().length >= 2 && !studentLookupBusy && !studentLookupError && <div className="student-assignment-results">{studentResults.length ? studentResults.map((student) => {
          const selected = selectedStudents.some((row) => row.id === student.id);
          return <label className="student-assignment-option" key={student.id}><input type="checkbox" checked={selected} onChange={(event) => setSelectedStudents((current) => event.target.checked ? [...current.filter((row) => row.id !== student.id), student] : current.filter((row) => row.id !== student.id))} /><span><strong>{[student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ')}</strong><small>{student.admissionNumber}</small></span></label>;
        }) : <p className="muted">No active people in this branch matched that search.</p>}</div>}
        <p className="field-hint" aria-live="polite">{selectedStudents.length} person{selectedStudents.length === 1 ? '' : 's'} selected</p>
        {selectedStudents.length > 0 && <div className="selected-student-list">{selectedStudents.map((student) => <span key={student.id}>{[student.firstName, student.lastName].filter(Boolean).join(' ')} · {student.admissionNumber}<button type="button" className="text-button" aria-label={`Remove ${student.firstName} ${student.lastName ?? ''}`} onClick={() => setSelectedStudents((current) => current.filter((row) => row.id !== student.id))}>Remove</button></span>)}</div>}
      </div> : targetType === 'PERSON' ? <div className="student-assignment-picker">
        <label>Assign people using<select value={personGroupMode ? 'GROUP' : 'PEOPLE'} onChange={(event) => { setPersonGroupMode(event.target.value === 'GROUP'); setSelectedPeople([]); setPersonSearch(''); }}><option value="PEOPLE">Selected people</option><option value="GROUP">A configured people group</option></select></label>
        {personGroupMode ? <label>People group<select name="targetId" required defaultValue=""><option value="">Choose a group</option>{personGroups.filter((group) => group.active).map((group) => <option key={group.id} value={group.id}>{group.name} · {group._count.members} active people</option>)}</select></label> : <>
          <label>Find organisation people<input type="search" value={personSearch} onChange={(event) => setPersonSearch(event.target.value)} placeholder="Search by name, person number, phone, or email" disabled={!branchId || !canReadPeople} /></label>
          <small className="field-hint">Selected people receive a separate fee demand. Tenant and branch permissions are enforced. Generic profiles support published fixed, configured-quantity, and configured-percentage items. Academic, formula, and usage charges need a configured module.</small>
          {!canReadPeople && <p className="notice notice-error" role="alert">Your role needs People read access to choose who receives a fee demand.</p>}
          {!branchId && <p className="muted">Choose a branch before searching.</p>}
          {personSearch.trim().length > 0 && personSearch.trim().length < 2 && <p className="muted">Type at least 2 characters to search.</p>}
          {personLookupBusy && <p className="muted" role="status">Searching organisation people…</p>}
          {personLookupError && <p className="notice notice-error" role="alert">{personLookupError}</p>}
          {personSearch.trim().length >= 2 && !personLookupBusy && !personLookupError && <div className="student-assignment-results">{personResults.length ? personResults.map((person) => {
            const selected = selectedPeople.some((row) => row.id === person.id);
            return <label className="student-assignment-option" key={person.id}><input type="checkbox" checked={selected} onChange={(event) => setSelectedPeople((current) => event.target.checked ? [...current.filter((row) => row.id !== person.id), person] : current.filter((row) => row.id !== person.id))} /><span><strong>{[person.firstName, person.middleName, person.lastName].filter(Boolean).join(' ')}</strong><small>{person.personNumber} · {person.typeLabel}</small></span></label>;
          }) : <p className="muted">No active people in this branch matched that search.</p>}</div>}
          <p className="field-hint" aria-live="polite">{selectedPeople.length} person{selectedPeople.length === 1 ? '' : 's'} selected</p>
          {selectedPeople.length > 0 && <div className="selected-student-list">{selectedPeople.map((person) => <span key={person.id}>{[person.firstName, person.lastName].filter(Boolean).join(' ')} · {person.personNumber}<button type="button" className="text-button" aria-label={`Remove ${person.firstName} ${person.lastName ?? ''}`} onClick={() => setSelectedPeople((current) => current.filter((row) => row.id !== person.id))}>Remove</button></span>)}</div>}
        </>}
      </div> : targetType === 'CUSTOM_GROUP' ? <label>Student group<select name="targetId" required defaultValue=""><option value="">Choose a group</option>{groups.filter((group) => group.isDynamic || group.name).map((group) => <option key={group.id} value={group.id}>{group.name}{group.isDynamic ? ' · rule based' : ''}</option>)}</select></label> : <UnitSelector units={units} unitType={targetType} />}
      {targetType !== 'PERSON' && <label>Academic year<select name="academicYearId" defaultValue=""><option value="">Use student or structure year</option>{academicYears.map((year) => <option key={year.id} value={year.id}>{year.name}{year.isCurrent ? ' · current' : ''}</option>)}</select></label>}
      <label>Demand due date<input name="dueDateOverride" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
      <label>Installment count<input type="number" min={0} max={60} value={installments.length} onChange={(event) => resizeInstallments(Math.max(0, Math.min(60, Number(event.target.value) || 0)))} /><small className="field-hint">Optional. Each share and due date can be changed below.</small></label>
      {installments.length > 0 && <div className="installment-draft-list">{installments.map((row, index) => <div className="installment-draft-row" key={index}><label>Label<input value={row.label} onChange={(event) => updateInstallment(index, 'label', event.target.value)} required maxLength={120} /></label><label>Share %<input value={row.percentage} onChange={(event) => updateInstallment(index, 'percentage', event.target.value)} required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" /></label><label>Due date<input type="date" value={row.dueDate} onChange={(event) => updateInstallment(index, 'dueDate', event.target.value)} required /></label></div>)}<small className="field-hint">Shares must add up to exactly 100%. Percentages are split across fee items with exact decimal arithmetic.</small></div>}
      <div className="assignment-submit"><button className="button button-primary" disabled={busyId === 'create' || !structure?.versions.some((v) => v.status === 'ACTIVE') || (targetType === 'STUDENT' && selectedStudents.length === 0) || (targetType === 'PERSON' && (!canReadPeople || (!personGroupMode && selectedPeople.length === 0)))}>{busyId === 'create' ? 'Saving…' : 'Create assignment'} <ArrowRight size={15} /></button></div>
    </form></section>
    <section className="surface-panel assignment-list-panel"><div className="section-heading section-heading-panel"><div><h2>Assignment runs</h2><p>Each billing cycle creates period-specific draft demands with saved calculation inputs.</p></div></div>{assignments.length ? <div className="table-wrap"><table><thead><tr><th>Branch</th><th>Target</th><th>Structure</th><th>Due date</th><th>Status</th><th>Generated</th><th></th></tr></thead><tbody>{assignments.map((row) => <tr key={row.id}><td>{branches.find((branch) => branch.id === row.branchId)?.name ?? (row.branchId ? 'Branch unavailable' : 'Unassigned')}</td><td><strong>{row.targetType === 'STUDENT' ? 'Education students' : row.targetType === 'PERSON' ? 'Organisation people' : enumLabel(row.targetType)}</strong><small className="table-subtext">{row.targetType === 'STUDENT' ? `${row.targetStudentIds?.length ?? 0} selected` : row.targetType === 'PERSON' ? row.targetPersonIds?.length ? `${row.targetPersonIds.length} selected` : personGroups.find((group) => group.id === row.targetId)?.name ?? 'People group' : units.find((unit) => unit.id === row.targetId)?.name ?? groups.find((group) => group.id === row.targetId)?.name ?? (row.targetId ? 'Selected group' : 'All matching people')}</small></td><td>{structures.find((s) => s.id === row.feeStructureId)?.name ?? 'Fee schedule'}</td><td>{row.dueDateOverride ? formatIndianDate(new Date(row.dueDateOverride)) : 'Per billing cycle'}</td><td><span className={`status-pill ${row.status === 'ACTIVE' ? 'status-green' : 'status-gray'}`}>{enumLabel(row.status)}{row.needsAttention ? ' · review' : ''}</span></td><td>{row.generatedAt ? formatIndianDate(new Date(row.generatedAt)) : '—'}</td><td>{row.targetType === 'PERSON' ? <div className="inline-actions"><button className="button button-secondary button-small" disabled={busyId === `cycle-open:${row.id}`} onClick={() => void openCycle(row.id)}><CalendarDays size={13} /> {busyId === `cycle-open:${row.id}` ? 'Loading…' : 'Billing cycles'}</button></div> : row.status === 'DRAFT' ? <button className="button button-secondary button-small" disabled={busyId === row.id} onClick={() => void generate(row.id)}><Play size={13} /> {busyId === row.id ? 'Generating…' : 'Generate'}</button> : <span className="muted">Complete</span>}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><WalletCards /></span><h2>No assignments yet</h2><p>Publish a fee structure version, then assign it to an academic group or organisation people.</p></div>}</section>
    {cycleAssignmentId && <div className="people-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyId.endsWith(':cycle')) setCycleAssignmentId(''); }}><section className="surface-panel people-editor fee-cycle-editor" role="dialog" aria-modal="true" aria-labelledby="fee-cycle-title"><div className="section-heading section-heading-panel"><div><p className="eyebrow">RECURRING FEE COLLECTION</p><h2 id="fee-cycle-title">Generate a billing cycle</h2><p className="muted">Review the billing period and enter any per-person usage or formula quantities. Saved inputs cannot be changed after a cycle starts.</p></div><button className="icon-button" aria-label="Close cycle generator" onClick={() => setCycleAssignmentId('')}><X size={16} /></button></div><div className="notice" role="note">After this first cycle, fixed and configured charges create draft demands automatically on the next period start. Usage, formula, and custom charges wait for staff readings; missed cycle dates need review. Draft demands still require approval before they post to the ledger.</div>{notice && <div className="notice notice-success" role="status">{notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
      {cycleInputs && <form className="people-editor-form" onSubmit={(event) => void generateCycle(event)}>
        <div className="assignment-form">
          <label>Billing frequency<select value={cycleFrequency} onChange={(event) => changeCycleFrequency(event.target.value)} required><option value="">Choose frequency</option>{[...new Set(cycleInputs.items.map((item) => item.frequency).filter((frequency) => ['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'TERM', 'SEMESTER'].includes(frequency)))].filter((frequency) => frequency !== 'ONE_TIME' || !cycleRuns.some((row) => row.frequency === 'ONE_TIME')).map((frequency) => <option key={frequency} value={frequency}>{enumLabel(frequency)}</option>)}</select></label>
          <label>Period starts<input type="date" value={periodStart} onChange={(event) => { setPeriodStart(event.target.value); if (cycleFrequency) setPeriodEnd(cycleEndDate(event.target.value, cycleFrequency)); }} required /></label>
          <label>Period ends<input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} required /></label>
          <label>Payment due date<input type="date" value={cycleDueDate} onChange={(event) => setCycleDueDate(event.target.value)} required /></label>
        </div>
        {cycleInputs.items.filter((item) => item.frequency === cycleFrequency).map((item) => <div className="notice" key={item.id}><strong>{item.name}</strong> · {enumLabel(item.calculationMethod)} · ₹{Number(item.amount).toLocaleString('en-IN')} {item.quantityRequired ? 'per entered unit' : 'configured charge'}</div>)}
        {cycleInputs.items.some((item) => item.frequency === cycleFrequency && item.quantityRequired) && <div className="table-wrap"><table><thead><tr><th>Person</th>{cycleInputs.items.filter((item) => item.frequency === cycleFrequency && item.quantityRequired).map((item) => <th key={item.id}>{item.name} quantity</th>)}</tr></thead><tbody>{cycleInputs.people.map((person) => <tr key={person.id}><td><strong>{[person.firstName, person.middleName, person.lastName].filter(Boolean).join(' ')}</strong><small className="table-subtext">{person.personNumber}</small></td>{cycleInputs.items.filter((item) => item.frequency === cycleFrequency && item.quantityRequired).map((item) => { const key = `${person.id}:${item.id}`; return <td key={item.id}><input aria-label={`${person.personNumber} ${item.name} quantity`} inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,4})?" value={cycleQuantities[key] ?? ''} onChange={(event) => setCycleQuantities((current) => ({ ...current, [key]: event.target.value }))} required /></td>; })}</tr>)}</tbody></table></div>}
        {cycleInputs.people.length === 0 && <p className="notice notice-error">There are no active people in this assignment.</p>}
        <div className="section-heading section-heading-panel"><div><h3>Previous cycles</h3><p>Completed periods stay available in Fee Demands with their original amounts and quantity inputs.</p></div></div>
        {cycleRuns.length > 0 ? <div className="table-wrap"><table><thead><tr><th>Frequency</th><th>Period</th><th>Due</th><th>Status</th><th>Demands</th></tr></thead><tbody>{cycleRuns.map((cycle) => <tr key={cycle.id}><td>{enumLabel(cycle.frequency)}</td><td>{formatIndianDate(new Date(cycle.periodStart))} – {formatIndianDate(new Date(cycle.periodEnd))}</td><td>{formatIndianDate(new Date(cycle.dueDate))}</td><td>{enumLabel(cycle.status)}</td><td>{String(cycle.summary?.demandsCreated ?? 0)}</td></tr>)}</tbody></table></div> : <p className="muted">No previous cycles for this assignment.</p>}
        <div className="assignment-submit"><button className="button button-primary" disabled={!cycleFrequency || cycleInputs.people.length === 0 || busyId === `${cycleAssignmentId}:cycle`}>{busyId === `${cycleAssignmentId}:cycle` ? 'Generating cycle…' : 'Generate fee demands'} <ArrowRight size={15} /></button></div>
      </form>}
    </section></div>}
  </main>;
}

function UnitSelector({ units, unitType }: { units: Unit[]; unitType: string }) {
  return <label>Academic unit<select name="targetId" required defaultValue=""><option value="">Choose a unit</option>{units.filter((unit) => unit.unitType === unitType).map((unit) => <option key={unit.id} value={unit.id}>{unit.name} · {unit.code}</option>)}</select></label>;
}

function formatPercentage(units: number): string { return `${Math.floor(units / 1_000_000)}.${String(units % 1_000_000).padStart(6, '0')}`; }
function firstDayOfCurrentMonth(): string { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`; }
function addDays(value: string, days: number): string { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function cycleEndDate(start: string, frequency: string): string {
  if (!start) return '';
  if (frequency === 'ONE_TIME') return start;
  const months = frequency === 'QUARTERLY' ? 3 : frequency === 'HALF_YEARLY' || frequency === 'SEMESTER' ? 6 : frequency === 'ANNUAL' ? 12 : frequency === 'TERM' ? 3 : 1;
  const date = new Date(`${start}T00:00:00.000Z`); date.setUTCMonth(date.getUTCMonth() + months); date.setUTCDate(date.getUTCDate() - 1); return date.toISOString().slice(0, 10);
}
