'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ASSIGNMENT_TARGET_TYPES, enumLabel } from '@fee/types';
import { ApiError, apiRequest } from '../../lib/api';
import { ArrowRight, Play, UsersRound, WalletCards } from 'lucide-react';

interface Structure { id: string; name: string; code: string }
interface Version { id: string; version: number; status: string; effectiveFrom: string; effectiveTo: string | null }
interface StructureDetail extends Structure { versions: Version[] }
interface Unit { id: string; name: string; code: string; unitType: string }
interface StudentGroup { id: string; name: string; code: string; isDynamic: boolean }
interface AcademicYear { id: string; name: string; isCurrent: boolean; startDate: string; endDate: string }
interface Assignment { id: string; feeStructureId: string; feeStructureVersionId: string; targetType: string; targetId: string | null; status: string; dueDateOverride: string | null; needsAttention: boolean; generatedAt: string | null; generationSummary: Record<string, unknown> | null }
interface InstallmentDraft { label: string; dueDate: string; percentage: string }
interface Page<T> { items: T[]; pagination: { total: number } }

export default function FeeAssignmentsPage() {
  const [assignments, setAssignments] = useState<Assignment[]>([]); const [structures, setStructures] = useState<Structure[]>([]); const [units, setUnits] = useState<Unit[]>([]); const [groups, setGroups] = useState<StudentGroup[]>([]); const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [structure, setStructure] = useState<StructureDetail | null>(null); const [structureId, setStructureId] = useState('');
  const [targetType, setTargetType] = useState('CLASS');
  const [installments, setInstallments] = useState<InstallmentDraft[]>([]);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busyId, setBusyId] = useState('');
  const load = useCallback(async () => {
    try { const [assignmentPage, structurePage, unitPage, groupPage, yearPage] = await Promise.all([apiRequest<Page<Assignment>>('/fee-assignments?pageSize=100'), apiRequest<Page<Structure>>('/fee-structures?pageSize=100'), apiRequest<Page<Unit>>('/academic-units?pageSize=200'), apiRequest<Page<StudentGroup>>('/student-groups?pageSize=200'), apiRequest<Page<AcademicYear>>('/academic-years?pageSize=200&sort=-startDate')]); setAssignments(assignmentPage.items); setStructures(structurePage.items); setUnits(unitPage.items); setGroups(groupPage.items); setAcademicYears(yearPage.items); setError(''); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Assignments could not be loaded.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!structureId) { setStructure(null); return; }
    void apiRequest<StructureDetail>(`/fee-structures/${structureId}`).then(setStructure).catch((cause) => setError(cause instanceof ApiError ? cause.message : 'Schedule versions could not be loaded.'));
  }, [structureId]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); setError(''); setBusyId('create');
    try {
      const installmentRule = installments.length ? { basis: 'PERCENTAGE', installments } : null;
      await apiRequest('/fee-assignments', { method: 'POST', body: JSON.stringify({ feeStructureId: values.get('structureId'), feeStructureVersionId: values.get('versionId'), targetType: values.get('targetType'), targetId: values.get('targetId'), academicYearId: values.get('academicYearId') || null, dueDateOverride: values.get('dueDateOverride'), installmentRule }) });
      form.reset(); setInstallments([]); setStructureId(''); setStructure(null); setTargetType('CLASS'); setNotice('Assignment created as a draft. Generate demands after confirming its fee and installment dates.'); await load();
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

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">FEE OPERATIONS</p><h1>Assignments</h1><p className="muted">Apply a published schedule to an academic group, then generate explainable student demands.</p></div><span className="heading-count"><UsersRound size={16} /> {assignments.length} assignments</span></div>
    {notice && <div className="notice notice-success" role="status">{notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    <section className="surface-panel assignment-create-panel"><div className="section-heading section-heading-panel"><div><h2>New assignment</h2><p>Only published fee structure versions can be assigned.</p></div></div><form className="assignment-form" onSubmit={create}>
      <label>Fee structure<select name="structureId" value={structureId} onChange={(e) => setStructureId(e.target.value)} required><option value="">Choose a schedule</option>{structures.map((row) => <option key={row.id} value={row.id}>{row.name} ({row.code})</option>)}</select></label>
      <label>Published version<select name="versionId" required disabled={!structure}><option value="">Choose version</option>{structure?.versions.filter((v) => v.status === 'ACTIVE').map((v) => <option key={v.id} value={v.id}>Version {v.version} · from {new Date(v.effectiveFrom).toLocaleDateString()}</option>)}</select></label>
      <label>Assign to<select name="targetType" value={targetType} onChange={(event) => setTargetType(event.target.value)} required>{ASSIGNMENT_TARGET_TYPES.filter((type) => type !== 'STUDENT').map((type) => <option key={type} value={type}>{enumLabel(type)}</option>)}</select></label>
      {targetType === 'CUSTOM_GROUP' ? <label>Student group<select name="targetId" required defaultValue=""><option value="">Choose a group</option>{groups.filter((group) => group.isDynamic || group.name).map((group) => <option key={group.id} value={group.id}>{group.name}{group.isDynamic ? ' · rule based' : ''}</option>)}</select></label> : <UnitSelector units={units} unitType={targetType} />}
      <label>Academic year<select name="academicYearId" defaultValue=""><option value="">Use student or structure year</option>{academicYears.map((year) => <option key={year.id} value={year.id}>{year.name}{year.isCurrent ? ' · current' : ''}</option>)}</select></label>
      <label>Demand due date<input name="dueDateOverride" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
      <label>Installment count<input type="number" min={0} max={60} value={installments.length} onChange={(event) => resizeInstallments(Math.max(0, Math.min(60, Number(event.target.value) || 0)))} /><small className="field-hint">Optional. Each share and due date can be changed below.</small></label>
      {installments.length > 0 && <div className="installment-draft-list">{installments.map((row, index) => <div className="installment-draft-row" key={index}><label>Label<input value={row.label} onChange={(event) => updateInstallment(index, 'label', event.target.value)} required maxLength={120} /></label><label>Share %<input value={row.percentage} onChange={(event) => updateInstallment(index, 'percentage', event.target.value)} required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" /></label><label>Due date<input type="date" value={row.dueDate} onChange={(event) => updateInstallment(index, 'dueDate', event.target.value)} required /></label></div>)}<small className="field-hint">Shares must add up to exactly 100%. Percentages are split across fee items with exact decimal arithmetic.</small></div>}
      <div className="assignment-submit"><button className="button button-primary" disabled={busyId === 'create' || !structure?.versions.some((v) => v.status === 'ACTIVE')}>{busyId === 'create' ? 'Saving…' : 'Create assignment'} <ArrowRight size={15} /></button></div>
    </form></section>
    <section className="surface-panel assignment-list-panel"><div className="section-heading section-heading-panel"><div><h2>Assignment runs</h2><p>Generation creates immutable draft demands with calculation and adjustment snapshots.</p></div></div>{assignments.length ? <div className="table-wrap"><table><thead><tr><th>Target</th><th>Structure</th><th>Due date</th><th>Status</th><th>Generated</th><th></th></tr></thead><tbody>{assignments.map((row) => <tr key={row.id}><td><strong>{enumLabel(row.targetType)}</strong><small className="table-subtext">{units.find((unit) => unit.id === row.targetId)?.name ?? groups.find((group) => group.id === row.targetId)?.name ?? (row.targetId ? 'Selected group' : 'All matching students')}</small></td><td>{structures.find((s) => s.id === row.feeStructureId)?.name ?? 'Fee schedule'}</td><td>{row.dueDateOverride ? new Date(row.dueDateOverride).toLocaleDateString() : 'Item dates'}</td><td><span className={`status-pill ${row.status === 'ACTIVE' ? 'status-green' : 'status-gray'}`}>{enumLabel(row.status)}{row.needsAttention ? ' · review' : ''}</span></td><td>{row.generatedAt ? new Date(row.generatedAt).toLocaleDateString() : '—'}</td><td>{row.status === 'DRAFT' ? <button className="button button-secondary button-small" disabled={busyId === row.id} onClick={() => void generate(row.id)}><Play size={13} /> {busyId === row.id ? 'Generating…' : 'Generate'}</button> : <span className="muted">Complete</span>}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><WalletCards /></span><h2>No assignments yet</h2><p>Publish a fee structure version, then assign it to a class or program.</p></div>}</section>
  </main>;
}

function UnitSelector({ units, unitType }: { units: Unit[]; unitType: string }) {
  return <label>Academic unit<select name="targetId" required defaultValue=""><option value="">Choose a unit</option>{units.filter((unit) => unit.unitType === unitType).map((unit) => <option key={unit.id} value={unit.id}>{unit.name} · {unit.code}</option>)}</select></label>;
}

function formatPercentage(units: number): string { return `${Math.floor(units / 1_000_000)}.${String(units % 1_000_000).padStart(6, '0')}`; }
