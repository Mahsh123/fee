'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { CalendarCheck, Check, ClipboardCheck, UsersRound } from 'lucide-react';
import { organizationCategory, PERMISSIONS } from '@fee/types';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { formatIndianDate } from '../../lib/locale';
import { useSession } from '../../components/session-provider';
import { useTenant } from '../../components/tenant-provider';

type Page<T> = { items: T[]; pagination: { total: number } };
type Branch = { id: string; code: string; name: string; status: string };
type AcademicUnit = { id: string; code: string; name: string; unitType: string; active: boolean };
type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'EXCUSED';
type RosterStudent = {
  id: string; admissionNumber?: string; personNumber?: string; typeLabel?: string; rollNumber?: string | null; firstName: string; middleName: string | null; lastName: string | null;
  attendance: { status: AttendanceStatus; remarks: string | null } | null;
};
type Roster = {
  branch: { id: string; name: string; code: string };
  academicUnit: { id: string; name: string; code: string; unitType: string } | null;
  personGroup?: { id: string; name: string; code: string } | null;
  subjectKind: 'STUDENT' | 'PERSON';
  attendanceDate: string; sessionLabel: string; sessionId: string | null; students: RosterStudent[];
};
type PersonGroup = { id: string; name: string; code: string; active: boolean; typeKey: string | null };

const statusOptions: Array<{ value: AttendanceStatus; label: string }> = [
  { value: 'PRESENT', label: 'Present' },
  { value: 'ABSENT', label: 'Absent' },
  { value: 'LATE', label: 'Late' },
  { value: 'EXCUSED', label: 'Excused' },
];

export default function AttendancePage() {
  const { user } = useSession();
  const tenant = useTenant();
  const category = organizationCategory(tenant.kind === 'tenant' ? tenant.organizationCategory : null);
  const personLabel = category.personLabel;
  const supportsAcademicAttendance = (category.suggestedModules as readonly string[]).includes('ADMISSIONS');
  const canRead = hasPermission(user, PERMISSIONS.ATTENDANCE_READ);
  const canMark = hasPermission(user, PERMISSIONS.ATTENDANCE_MARK);
  const canCorrect = hasPermission(user, PERMISSIONS.ATTENDANCE_CORRECT);
  const canReadBranches = hasPermission(user, PERMISSIONS.BRANCH_READ);
  const canReadUnits = hasPermission(user, PERMISSIONS.STUDENT_READ);
  const canReadPeopleGroups = hasPermission(user, PERMISSIONS.USER_READ);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [units, setUnits] = useState<AcademicUnit[]>([]);
  const [personGroups, setPersonGroups] = useState<PersonGroup[]>([]);
  const [subjectKind, setSubjectKind] = useState<'STUDENT' | 'PERSON'>('PERSON');
  const [personGroupId, setPersonGroupId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [academicUnitId, setAcademicUnitId] = useState('');
  const [attendanceDate, setAttendanceDate] = useState(todayInIndia());
  const [sessionLabel, setSessionLabel] = useState('FULL_DAY');
  const [roster, setRoster] = useState<Roster | null>(null);
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus | ''>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [choicesLoadFailed, setChoicesLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const canUseAttendance = canRead && canReadBranches;
  const loadChoices = useCallback(async () => {
    if (!canUseAttendance) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setChoicesLoadFailed(false);
    setError('');
    try {
      const [branchPage, unitPage, groups] = await Promise.all([
        apiRequest<Page<Branch>>('/branches?pageSize=200&status=ACTIVE'),
        canReadUnits ? apiRequest<Page<AcademicUnit>>('/academic-units?pageSize=200&status=ACTIVE').catch(() => ({ items: [] as AcademicUnit[] })) : Promise.resolve({ items: [] as AcademicUnit[] }),
        canReadPeopleGroups ? apiRequest<PersonGroup[]>('/people/groups').catch(() => [] as PersonGroup[]) : Promise.resolve([] as PersonGroup[]),
      ]);
      const activeBranches = branchPage.items.filter((branch) => branch.status === 'ACTIVE');
      const activeUnits = unitPage.items.filter((unit) => unit.active);
      setBranches(activeBranches);
      setUnits(activeUnits);
      setPersonGroups(groups.filter((group) => group.active));
      setBranchId((current) => activeBranches.some((branch) => branch.id === current) ? current : activeBranches[0]?.id ?? '');
      setAcademicUnitId((current) => activeUnits.some((unit) => unit.id === current) ? current : activeUnits[0]?.id ?? '');
      setPersonGroupId((current) => groups.some((group) => group.id === current && group.active) ? current : '');
    } catch (cause) {
      setChoicesLoadFailed(true);
      setError(cause instanceof ApiError ? cause.message : 'Attendance setup could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [canReadPeopleGroups, canReadUnits, canUseAttendance]);

  useEffect(() => { void loadChoices(); }, [loadChoices]);
  useEffect(() => {
    setSubjectKind(canReadUnits && supportsAcademicAttendance ? 'STUDENT' : 'PERSON');
  }, [canReadUnits, supportsAcademicAttendance]);

  const rosterUrl = useMemo(() => {
    if (!branchId || !attendanceDate || !sessionLabel.trim() || (subjectKind === 'STUDENT' && (!academicUnitId || !canReadUnits))) return '';
    const query = new URLSearchParams({ branchId, date: attendanceDate, sessionLabel: sessionLabel.trim() });
    if (subjectKind === 'PERSON' && personGroupId) query.set('personGroupId', personGroupId);
    return subjectKind === 'PERSON' ? `/attendance/people/roster?${query.toString()}` : `/attendance/units/${encodeURIComponent(academicUnitId)}/roster?${query.toString()}`;
  }, [academicUnitId, attendanceDate, branchId, canReadUnits, personGroupId, sessionLabel, subjectKind]);

  async function fetchRoster() {
    if (!rosterUrl) return;
    if (subjectKind === 'PERSON') {
      const result = await apiRequest<{ branch: Roster['branch']; personGroup: Roster['personGroup']; attendanceDate: string; sessionLabel: string; sessionId: string | null; people: RosterStudent[] }>(rosterUrl);
      const normalized: Roster = { ...result, academicUnit: null, subjectKind: 'PERSON', personGroup: result.personGroup ?? null, students: result.people };
      setRoster(normalized);
      setStatuses(Object.fromEntries(normalized.students.map((person) => [person.id, person.attendance?.status ?? ''])));
      setRemarks(Object.fromEntries(normalized.students.map((person) => [person.id, person.attendance?.remarks ?? ''])));
    } else {
      const result = await apiRequest<Omit<Roster, 'subjectKind' | 'personGroup'> & { academicUnit: NonNullable<Roster['academicUnit']> }>(rosterUrl);
      const normalized: Roster = { ...result, subjectKind: 'STUDENT', personGroup: null };
      setRoster(normalized);
      setStatuses(Object.fromEntries(normalized.students.map((student) => [student.id, student.attendance?.status ?? ''])));
      setRemarks(Object.fromEntries(normalized.students.map((student) => [student.id, student.attendance?.remarks ?? ''])));
    }
  }

  async function showRoster(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice(''); setRoster(null);
    try { await fetchRoster(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The attendance register could not be loaded.'); }
    finally { setBusy(false); }
  }

  async function saveAttendance() {
    if (!roster) return;
    const records = roster.students.map((student) => ({
      ...(roster.subjectKind === 'PERSON' ? { personId: student.id } : { studentId: student.id }),
      status: statuses[student.id], remarks: remarks[student.id]?.trim() || null,
    }));
    if (records.some((record) => !record.status)) {
      setError('Choose a status for every student before saving attendance.');
      return;
    }

    setBusy(true); setError(''); setNotice('');
    try {
      if (roster.sessionId) {
        if (!canCorrect) throw new Error('Your role can view this register but cannot correct a saved session.');
        await apiRequest(`${roster.subjectKind === 'PERSON' ? '/attendance/people' : '/attendance'}/sessions/${encodeURIComponent(roster.sessionId)}/records`, {
          method: 'PATCH', body: JSON.stringify({ records }),
        });
        setNotice('Attendance corrections were saved and recorded in the audit log.');
      } else {
        if (!canMark) throw new Error('Your role can view attendance but cannot mark a new session.');
        const created = await apiRequest<{ id: string }>(roster.subjectKind === 'PERSON' ? '/attendance/people/sessions' : '/attendance/sessions', {
          method: 'POST',
          body: JSON.stringify({
            branchId: roster.branch.id,
            ...(roster.subjectKind === 'PERSON' ? { personGroupId: roster.personGroup?.id ?? null } : { academicUnitId: roster.academicUnit?.id }),
            attendanceDate: roster.attendanceDate,
            sessionLabel: roster.sessionLabel,
            idempotencyKey: globalThis.crypto.randomUUID(),
            records,
          }),
        });
        setRoster((current) => current ? { ...current, sessionId: created.id } : current);
        setNotice('Attendance was marked and recorded in the audit log.');
      }
      setRoster((current) => current ? {
        ...current,
        students: current.students.map((student) => ({
          ...student,
          attendance: { status: statuses[student.id] as AttendanceStatus, remarks: remarks[student.id]?.trim() || null },
        })),
      } : current);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'ATTENDANCE_SESSION_EXISTS') {
        try {
          await fetchRoster();
          setNotice('This session was already saved. The existing register has been reloaded.');
        } catch {
          setError('This session was already saved, but its current register could not be reloaded. Try opening it again.');
        }
      } else {
        setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : 'Attendance could not be saved.');
      }
    } finally { setBusy(false); }
  }

  const totals = useMemo(() => statusOptions.map(({ value, label }) => ({
    value, label, count: Object.values(statuses).filter((status) => status === value).length,
  })), [statuses]);

  if (!canUseAttendance) return <main id="main-content" className="page-content"><div className="page-heading"><div><p className="eyebrow">ATTENDANCE</p><h1>Attendance register</h1></div></div><div className="notice notice-error" role="alert">Attendance requires attendance read and branch read permissions. Ask your Tenant Admin to assign the missing access.</div></main>;

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">ATTENDANCE</p><h1>Attendance register</h1><p className="muted">Mark or correct a group’s attendance for one branch, date, and session.</p></div><span className="heading-count"><CalendarCheck size={16} /> Tenant and branch scoped</span></div>
    {notice && <div className="notice notice-success" role="status"><Check size={16} /> {notice}</div>}
    {error && <div className="notice notice-error" role="alert">{error}</div>}

    <section className="surface-panel attendance-filter-panel">
      <div className="section-heading section-heading-panel"><div><h2>Choose register</h2><p>Use the people register for any organisation, or the academic register for a school.</p></div><ClipboardCheck size={18} /></div>
      {loading ? <div className="loading-page" role="status">Loading branches and groups…</div>
        : choicesLoadFailed ? <div className="empty-state"><span className="empty-icon"><UsersRound /></span><h2>Attendance setup could not be loaded</h2><p>Check your connection and retry. The workspace configuration has not been changed.</p><button className="button button-secondary" onClick={() => void loadChoices()}>Try again</button></div>
          : !branches.length ? <div className="empty-state"><span className="empty-icon"><UsersRound /></span><h2>Attendance setup is incomplete</h2><p>Create an active branch first.</p><div className="attendance-setup-links"><Link className="button button-secondary button-small" href="/organization">Manage branches</Link></div></div>
          : <form className="attendance-filter-form" onSubmit={(event) => void showRoster(event)}>
            <label>Register type<select value={subjectKind} onChange={(event) => { setSubjectKind(event.target.value as 'PERSON' | 'STUDENT'); setRoster(null); }}><option value="PERSON">{category.peopleLabel}</option><option value="STUDENT" disabled={!canReadUnits}>Academic students</option></select></label>
            <label>Branch<select required value={branchId} onChange={(event) => { setBranchId(event.target.value); setRoster(null); }}><option value="">Choose branch</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} · {branch.code}</option>)}</select></label>
            {subjectKind === 'PERSON' ? <label>{personLabel} group (optional)<select value={personGroupId} onChange={(event) => { setPersonGroupId(event.target.value); setRoster(null); }}><option value="">All active {category.peopleLabel.toLowerCase()} in branch</option>{personGroups.map((group) => <option key={group.id} value={group.id}>{group.name} · {group.code}</option>)}</select></label> : <label>Academic group<select required value={academicUnitId} onChange={(event) => { setAcademicUnitId(event.target.value); setRoster(null); }}><option value="">Choose group</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} · {unit.code}</option>)}</select></label>}
            <label>Date<input type="date" required value={attendanceDate} onChange={(event) => { setAttendanceDate(event.target.value); setRoster(null); }} /></label>
            <label>Session<input value={sessionLabel} required maxLength={40} placeholder="FULL_DAY or Morning" onChange={(event) => { setSessionLabel(event.target.value); setRoster(null); }} /></label>
            <button className="button button-primary" disabled={busy || !rosterUrl}>{busy ? 'Loading…' : 'Open register'}</button>
          </form>}
    </section>

    {roster && <section className="surface-panel attendance-roster-panel">
      <div className="section-heading section-heading-panel"><div><h2>{roster.personGroup?.name ?? roster.academicUnit?.name ?? `All ${category.peopleLabel.toLowerCase()}`} · {roster.branch.name}</h2><p>{formatIndianDate(new Date(`${roster.attendanceDate}T00:00:00.000Z`))} · {roster.sessionLabel.replaceAll('_', ' ')}</p></div><span className="heading-count">{roster.students.length} {roster.subjectKind === 'PERSON' ? category.peopleLabel.toLowerCase() : 'students'}</span></div>
      {roster.students.length > 0 && <div className="attendance-summary" aria-label="Attendance totals">{totals.map((total) => <span key={total.value}><strong>{total.count}</strong> {total.label.toLowerCase()}</span>)}</div>}
      {roster.students.length ? <><div className="table-wrap attendance-table-wrap"><table><thead><tr><th>{roster.subjectKind === 'PERSON' ? personLabel : 'Student'}</th><th>Attendance</th><th>Remarks</th></tr></thead><tbody>{roster.students.map((student) => {
        const name = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ');
        const canEdit = roster.sessionId ? canCorrect : canMark;
        return <tr key={student.id}><td><strong>{name}</strong><small className="table-subtext">{student.rollNumber ? `Roll ${student.rollNumber} · ` : ''}{roster.subjectKind === 'PERSON' ? `${student.typeLabel ?? 'Person'} · ${student.personNumber ?? ''}` : student.admissionNumber}</small></td><td><select aria-label={`Attendance for ${name}`} value={statuses[student.id] ?? ''} disabled={!canEdit || busy} onChange={(event) => setStatuses((current) => ({ ...current, [student.id]: event.target.value as AttendanceStatus | '' }))}><option value="">Choose status</option>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td><td><input aria-label={`Remarks for ${name}`} maxLength={500} value={remarks[student.id] ?? ''} disabled={!canEdit || busy} onChange={(event) => setRemarks((current) => ({ ...current, [student.id]: event.target.value }))} /></td></tr>;
      })}</tbody></table></div>
      {(roster.sessionId ? canCorrect : canMark) ? <div className="access-save-row"><span className="muted">{roster.sessionId ? 'Corrections are audited.' : 'Each person needs a status before the session can be saved.'}</span><button className="button button-primary" onClick={() => void saveAttendance()} disabled={busy}>{busy ? 'Saving…' : roster.sessionId ? 'Save corrections' : 'Mark attendance'}</button></div> : <p className="muted">This register is read-only for your role.</p>}</>
        : <div className="empty-state"><span className="empty-icon"><UsersRound /></span><h2>No {roster.subjectKind === 'PERSON' ? category.peopleLabel.toLowerCase() : 'students'} in this group</h2><p>No active records were assigned to this branch and group on the selected date.</p></div>}
    </section>}
  </main>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean {
  return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission));
}

function todayInIndia(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}
