'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ACADEMIC_UNIT_TYPES, CONDITION_OPERATORS, FEE_RULE_FIELDS, enumLabel } from '@fee/types';
import { ApiError, apiRequest } from '../../lib/api';
import { Check, Plus, School, UsersRound } from 'lucide-react';

interface Page<T> { items: T[]; pagination: { total: number } }
interface AcademicYear { id: string; name: string; startDate: string; endDate: string; isCurrent: boolean; isClosed: boolean }
interface Unit { id: string; unitType: string; name: string; code: string; parentId: string | null; active: boolean }
interface Student { id: string; admissionNumber: string; firstName: string; lastName: string | null; status: string }
interface GroupCondition { field: string; operator: string; value: string | boolean | string[]; valueType?: string; negate?: boolean }
interface MembershipRule { op: 'AND' | 'OR'; conditions: GroupCondition[] }
interface Group {
  id: string; name: string; code: string; description: string | null; isDynamic: boolean; active: boolean;
  membershipRule: MembershipRule | null; _count?: { members: number };
  members?: Array<{ studentId: string; student: Student }>;
}
interface GroupForm { name: string; code: string; description: string; mode: 'STATIC' | 'DYNAMIC'; op: 'AND' | 'OR'; conditions: GroupCondition[] }

const studentFields = FEE_RULE_FIELDS.filter((field) => field.group === 'Student');
const emptyCondition = (): GroupCondition => ({ field: 'student.category', operator: 'EQ', value: '' });

export default function AcademicPage() {
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentOptions, setStudentOptions] = useState<Record<string, Student>>({});
  const [selectedYear, setSelectedYear] = useState<AcademicYear | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [groupForm, setGroupForm] = useState<GroupForm>({ name: '', code: '', description: '', mode: 'STATIC', op: 'AND', conditions: [emptyCondition()] });
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    const results = await Promise.allSettled([
      apiRequest<Page<AcademicYear>>('/academic-years?pageSize=200&sort=-startDate'),
      apiRequest<Page<Unit>>('/academic-units?pageSize=200'),
      apiRequest<Page<Group>>('/student-groups?pageSize=200'),
      apiRequest<Page<Student>>('/students?pageSize=200&status=ACTIVE'),
    ]);
    const failures: string[] = [];
    if (results[0].status === 'fulfilled') setYears(results[0].value.items); else failures.push('academic years');
    if (results[1].status === 'fulfilled') setUnits(results[1].value.items); else failures.push('academic units');
    if (results[2].status === 'fulfilled') setGroups(results[2].value.items); else failures.push('student groups');
    if (results[3].status === 'fulfilled') {
      const studentRows = results[3].value.items;
      setStudents(studentRows);
      setStudentOptions((current) => ({ ...current, ...Object.fromEntries(studentRows.map((student) => [student.id, student])) }));
    } else failures.push('student list');
    if (failures.length) setError(`Some records could not be loaded: ${failures.join(', ')}. Your role may need additional access.`);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const groupOptions = useMemo(() => Object.values(studentOptions).sort((a, b) => a.admissionNumber.localeCompare(b.admissionNumber)), [studentOptions]);

  async function searchStudents(value: string) {
    setStudentSearch(value);
    try {
      const result = await apiRequest<Page<Student>>(`/students?pageSize=200&status=ACTIVE${value.trim() ? `&search=${encodeURIComponent(value.trim())}` : ''}`);
      setStudentOptions((current) => ({ ...current, ...Object.fromEntries(result.items.map((student) => [student.id, student])) }));
      setStudents(result.items);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Student search failed.'); }
  }

  async function saveYear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const values = new FormData(formElement); setBusy(true); setError(''); setNotice('');
    const payload = { name: values.get('name'), startDate: values.get('startDate'), endDate: values.get('endDate'), isCurrent: values.get('isCurrent') === 'on' };
    try {
      await apiRequest(selectedYear ? `/academic-years/${selectedYear.id}` : '/academic-years', { method: selectedYear ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      setNotice(selectedYear ? 'Academic year updated.' : 'Academic year created.'); setSelectedYear(null); formElement.reset(); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Academic year could not be saved.'); }
    finally { setBusy(false); }
  }

  async function markCurrent(year: AcademicYear) {
    setBusy(true); setError('');
    try { await apiRequest(`/academic-years/${year.id}`, { method: 'PATCH', body: JSON.stringify({ name: year.name, startDate: dateOnly(year.startDate), endDate: dateOnly(year.endDate), isCurrent: true }) }); setNotice(`${year.name} is now the current academic year.`); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The academic year could not be updated.'); }
    finally { setBusy(false); }
  }
  async function closeYear(year: AcademicYear) {
    setBusy(true); setError('');
    try { await apiRequest(`/academic-years/${year.id}/close`, { method: 'POST', body: '{}' }); setNotice(`${year.name} is closed and read-only.`); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The academic year could not be closed.'); }
    finally { setBusy(false); }
  }

  async function createUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const values = new FormData(formElement); setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest('/academic-units', { method: 'POST', body: JSON.stringify({ unitType: values.get('unitType'), name: values.get('name'), code: values.get('code'), parentId: values.get('parentId') || null, metadata: null }) });
      formElement.reset(); setNotice('Academic unit created.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Academic unit could not be created.'); }
    finally { setBusy(false); }
  }
  async function toggleUnit(unit: Unit) {
    setBusy(true); setError('');
    try { await apiRequest(`/academic-units/${unit.id}`, { method: 'PATCH', body: JSON.stringify({ active: !unit.active }) }); setNotice(`${unit.name} ${unit.active ? 'deactivated' : 'activated'}.`); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Academic unit could not be updated.'); }
    finally { setBusy(false); }
  }

  async function selectGroup(id: string) {
    setSelectedGroupId(id); setStudentSearch('');
    if (!id) { setGroupForm({ name: '', code: '', description: '', mode: 'STATIC', op: 'AND', conditions: [emptyCondition()] }); setMemberIds([]); return; }
    try {
      const group = await apiRequest<Group>(`/student-groups/${id}`);
      setGroupForm(toGroupForm(group));
      const loadedMembers = group.members ?? [];
      setMemberIds(loadedMembers.map((member) => member.studentId));
      setStudentOptions((current) => ({ ...current, ...Object.fromEntries(loadedMembers.map((member) => [member.student.id, member.student])) }));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Student group could not be loaded.'); }
  }
  function changeGroup<K extends keyof GroupForm>(key: K, value: GroupForm[K]) { setGroupForm((current) => ({ ...current, [key]: value })); }
  function changeCondition(index: number, key: keyof GroupCondition, value: string | boolean) {
    setGroupForm((current) => ({ ...current, conditions: current.conditions.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row) }));
  }
  async function saveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const payload = { name: groupForm.name, code: groupForm.code, description: groupForm.description || null, mode: groupForm.mode,
      membershipRule: groupForm.mode === 'DYNAMIC' ? { op: groupForm.op, conditions: groupForm.conditions.map(toCondition) } : null };
    try {
      const saved = await apiRequest<Group>(selectedGroupId ? `/student-groups/${selectedGroupId}` : '/student-groups', { method: selectedGroupId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
      if (!selectedGroupId) setSelectedGroupId(saved.id);
      setNotice(selectedGroupId ? 'Student group configuration saved.' : 'Student group created.'); await load();
      if (!selectedGroupId) await selectGroup(saved.id);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Student group could not be saved.'); }
    finally { setBusy(false); }
  }
  async function saveMembers() {
    if (!selectedGroupId) return; setBusy(true); setError(''); setNotice('');
    try { await apiRequest(`/student-groups/${selectedGroupId}/members`, { method: 'PUT', body: JSON.stringify({ studentIds: memberIds }) }); setNotice(`${memberIds.length} student(s) now belong to this group.`); await selectGroup(selectedGroupId); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Group membership could not be saved.'); }
    finally { setBusy(false); }
  }

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">INSTITUTION STRUCTURE</p><h1>Academic structure</h1><p className="muted">Configure academic years, units, and reusable student groups.</p></div><span className="heading-count"><School size={16} /> Tenant scoped</span></div>
    {notice && <div className="notice notice-success" role="status"><Check size={16} /> {notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}

    <section className="surface-panel academic-years-panel"><div className="section-heading section-heading-panel"><div><h2>Academic years</h2><p>Only one year is current. Closing a year makes its dates immutable.</p></div></div>
      <form className="academic-inline-form" onSubmit={saveYear}><label>Name<input name="name" required maxLength={40} defaultValue={selectedYear?.name ?? ''} key={`year-name-${selectedYear?.id ?? 'new'}`} /></label><label>Start date<input name="startDate" type="date" required defaultValue={selectedYear ? dateOnly(selectedYear.startDate) : ''} key={`year-start-${selectedYear?.id ?? 'new'}`} /></label><label>End date<input name="endDate" type="date" required defaultValue={selectedYear ? dateOnly(selectedYear.endDate) : ''} key={`year-end-${selectedYear?.id ?? 'new'}`} /></label><label className="check-label"><input name="isCurrent" type="checkbox" defaultChecked={selectedYear?.isCurrent ?? false} key={`year-current-${selectedYear?.id ?? 'new'}`} /> Current</label><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : selectedYear ? 'Save year' : 'Add year'}</button>{selectedYear && <button type="button" className="button button-secondary" onClick={() => setSelectedYear(null)}>New</button>}</form>
      {years.length ? <div className="table-wrap"><table><thead><tr><th>Academic year</th><th>Dates</th><th>Status</th><th>Actions</th></tr></thead><tbody>{years.map((year) => <tr key={year.id}><td><strong>{year.name}</strong></td><td>{dateOnly(year.startDate)} – {dateOnly(year.endDate)}</td><td><span className={`status-pill ${year.isCurrent ? 'status-green' : year.isClosed ? 'status-gray' : 'status-amber'}`}>{year.isClosed ? 'Closed' : year.isCurrent ? 'Current' : 'Upcoming / past'}</span></td><td className="academic-actions">{!year.isClosed && <><button className="button button-secondary button-small" onClick={() => setSelectedYear(year)}>Edit</button>{!year.isCurrent && <button className="button button-secondary button-small" onClick={() => void markCurrent(year)} disabled={busy}>Make current</button>}<button className="button button-secondary button-small" onClick={() => void closeYear(year)} disabled={busy}>Close</button></>}</td></tr>)}</tbody></table></div> : <div className="empty-inline">No academic years configured.</div>}
    </section>

    <div className="academic-layout">
      <section className="surface-panel academic-units-panel"><div className="section-heading section-heading-panel"><div><h2>Academic units</h2><p>Build a tenant-specific hierarchy of programs, classes, departments, hostels, and routes.</p></div></div>
        <form className="academic-unit-form" onSubmit={createUnit}><label>Unit type<select name="unitType" required>{ACADEMIC_UNIT_TYPES.map((type) => <option value={type} key={type}>{enumLabel(type)}</option>)}</select></label><label>Name<input name="name" required maxLength={160} /></label><label>Code<input name="code" required maxLength={64} /></label><label>Parent unit<select name="parentId"><option value="">No parent</option>{units.filter((unit) => unit.active).map((unit) => <option value={unit.id} key={unit.id}>{unit.name} · {enumLabel(unit.unitType)}</option>)}</select></label><button className="button button-primary" disabled={busy}><Plus size={15} /> Add unit</button></form>
        {units.length ? <div className="table-wrap"><table><thead><tr><th>Unit</th><th>Type</th><th>Code</th><th></th></tr></thead><tbody>{units.map((unit) => <tr key={unit.id}><td>{unit.name}</td><td>{enumLabel(unit.unitType)}</td><td>{unit.code}</td><td><button className="button button-secondary button-small" onClick={() => void toggleUnit(unit)} disabled={busy}>{unit.active ? 'Deactivate' : 'Activate'}</button></td></tr>)}</tbody></table></div> : <div className="empty-inline">No academic units configured.</div>}
      </section>

      <section className="surface-panel student-groups-panel"><div className="section-heading section-heading-panel"><div><h2>Student groups</h2><p>Use manual membership or conditions that recalculate against student facts at demand generation.</p></div><UsersRound size={18} /></div>
        <label className="academic-picker">Edit group<select value={selectedGroupId} onChange={(event) => void selectGroup(event.target.value)}><option value="">Create a student group</option>{groups.map((group) => <option value={group.id} key={group.id}>{group.name} · {group.isDynamic ? 'Rule based' : `${group._count?.members ?? 0} students`}</option>)}</select></label>
        <form className="student-group-form" onSubmit={saveGroup}><div className="group-form-grid"><label>Name<input value={groupForm.name} onChange={(event) => changeGroup('name', event.target.value)} required maxLength={120} /></label><label>Code<input value={groupForm.code} onChange={(event) => changeGroup('code', event.target.value)} required maxLength={40} /></label><label>Description<input value={groupForm.description} onChange={(event) => changeGroup('description', event.target.value)} maxLength={1000} /></label><label>Membership<select value={groupForm.mode} onChange={(event) => changeGroup('mode', event.target.value as GroupForm['mode'])}><option value="STATIC">Manual students</option><option value="DYNAMIC">Rule based</option></select></label></div>
          {groupForm.mode === 'DYNAMIC' && <div className="membership-rule-builder"><div className="rule-builder-heading"><div><h3>Who belongs to this group?</h3><p>Each condition uses a saved student fact. Missing facts do not match.</p></div><label>Match<select value={groupForm.op} onChange={(event) => changeGroup('op', event.target.value as GroupForm['op'])}><option value="AND">All conditions</option><option value="OR">Any condition</option></select></label></div>{groupForm.conditions.map((condition, index) => <div className="group-condition-row" key={index}><label>Student fact<select value={condition.field.startsWith('student.customAttributes.') ? '__custom__' : condition.field} onChange={(event) => changeCondition(index, 'field', event.target.value === '__custom__' ? 'student.customAttributes.custom_field' : event.target.value)}>{studentFields.map((field) => <option key={field.path} value={field.path}>{field.label}</option>)}<option value="__custom__">Custom student attribute</option></select></label>{condition.field.startsWith('student.customAttributes.') && <label>Attribute key<input value={condition.field.slice('student.customAttributes.'.length)} onChange={(event) => changeCondition(index, 'field', `student.customAttributes.${event.target.value.replace(/[^A-Za-z0-9_.-]/g, '')}`)} /></label>}<label>Operator<select value={condition.operator} onChange={(event) => changeCondition(index, 'operator', event.target.value)}>{CONDITION_OPERATORS.map((operator) => <option value={operator} key={operator}>{enumLabel(operator)}</option>)}</select></label>{condition.operator !== 'EXISTS' && <label>Value{fieldKind(condition.field) === 'BOOLEAN' ? <select value={String(condition.value)} onChange={(event) => changeCondition(index, 'value', event.target.value === 'true')}><option value="true">Yes</option><option value="false">No</option></select> : <input value={String(condition.value)} onChange={(event) => changeCondition(index, 'value', event.target.value)} inputMode={fieldKind(condition.field) === 'NUMBER' ? 'decimal' : undefined} placeholder={condition.operator === 'IN' || condition.operator === 'NOT_IN' ? 'Comma-separated values' : 'Enter a value'} />}</label>}<button type="button" className="button button-secondary button-small" onClick={() => changeGroup('conditions', groupForm.conditions.filter((_, row) => row !== index))} disabled={groupForm.conditions.length === 1}>Remove</button></div>)}<button type="button" className="button button-secondary button-small" onClick={() => changeGroup('conditions', [...groupForm.conditions, emptyCondition()])} disabled={groupForm.conditions.length >= 50}><Plus size={13} /> Add condition</button></div>}
          <div className="academic-form-footer"><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : selectedGroupId ? 'Save group' : 'Create group'}</button></div>
        </form>
        {selectedGroupId && groupForm.mode === 'STATIC' && <div className="group-members-editor"><div className="section-heading section-heading-panel"><div><h3>Manual membership</h3><p>Search active students and select all current group members.</p></div></div><label className="student-member-search">Search students<input value={studentSearch} onChange={(event) => void searchStudents(event.target.value)} placeholder="Name or admission number" /></label><select className="student-member-select" multiple size={10} value={memberIds} onChange={(event) => setMemberIds([...event.currentTarget.selectedOptions].map((option) => option.value))}>{groupOptions.map((student) => <option key={student.id} value={student.id}>{student.firstName} {student.lastName ?? ''} · {student.admissionNumber}</option>)}</select><div className="academic-form-footer"><span className="muted">{memberIds.length} selected</span><button className="button button-primary" onClick={() => void saveMembers()} disabled={busy}>Save members</button></div></div>}
      </section>
    </div>
  </main>;
}

function toGroupForm(group: Group): GroupForm {
  const rule = group.membershipRule;
  const conditions = rule?.conditions?.length ? rule.conditions : [emptyCondition()];
  return { name: group.name, code: group.code, description: group.description ?? '', mode: group.isDynamic ? 'DYNAMIC' : 'STATIC', op: rule?.op ?? 'AND', conditions: conditions.map((condition) => ({ ...condition, value: condition.value ?? '' })) };
}
function toCondition(condition: GroupCondition) {
  const field = studentFields.find((row) => row.path === condition.field);
  const valueType = field?.valueType ?? 'STRING';
  let value: string | boolean | string[] | undefined = condition.value;
  if (condition.operator === 'EXISTS') value = undefined;
  else if ((condition.operator === 'IN' || condition.operator === 'NOT_IN' || condition.operator === 'BETWEEN') && typeof value === 'string') value = value.split(',').map((part) => part.trim()).filter(Boolean);
  else if (valueType === 'BOOLEAN' && typeof value === 'string') value = value === 'true';
  return { field: condition.field, operator: condition.operator, ...(value !== undefined ? { value } : {}), valueType, ...(condition.negate ? { negate: true } : {}) };
}
function fieldKind(path: string): string { return studentFields.find((field) => field.path === path)?.valueType ?? 'STRING'; }
function dateOnly(value: string): string { return value.slice(0, 10); }
