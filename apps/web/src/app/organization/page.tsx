'use client';
import { formatIndianDate } from '../../lib/locale';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Building2, Check, GitBranch, UsersRound } from 'lucide-react';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { useSession } from '../../components/session-provider';

interface Branch {
  id: string; code: string; name: string; status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'; memberCount: number;
  phone: string | null; email: string | null; capacity: number | null; address: Record<string, unknown> | null; managerId: string | null; updatedAt?: string;
  members: Array<{ userId: string; isPrimary: boolean }>;
  manager: { id: string; firstName: string; lastName: string | null; email: string } | null;
}
interface Unit { id: string; code: string; name: string; unitType: string; description: string | null; parentId: string | null; active: boolean; memberCount: number; memberships: Array<{ userId: string }> }
interface UserRow { id: string; email: string; firstName: string; lastName: string | null; status: string }
interface Assignment { id: string; userId: string; branchId: string | null; resourceType: string; resourceId: string; resourceLabel: string | null; status: string; dueAt: string | null }
interface PageResult<T> { items: T[]; pagination: { total: number } }

export default function OrganizationPage() {
  const { user } = useSession();
  const canReadBranches = hasPermission(user, 'branch.read');
  const canManageBranches = hasPermission(user, 'branch.manage');
  const canReadUnits = hasPermission(user, 'organization.unit.read');
  const canManageUnits = hasPermission(user, 'organization.unit.manage');
  const canReadAssignments = hasPermission(user, 'assignment.read');
  const canManageAssignments = hasPermission(user, 'assignment.manage');
  const canReadUsers = hasPermission(user, 'user.read');
  const canManageAllUserAccess = Boolean(user?.roles.some((role) => role === 'TENANT_ADMIN' || role === 'TENANT_OWNER'));
  const [branches, setBranches] = useState<Branch[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [branchMembers, setBranchMembers] = useState<Record<string, string[]>>({});
  const [unitMembers, setUnitMembers] = useState<Record<string, string[]>>({});
  const [userBranches, setUserBranches] = useState<Record<string, { branchIds: string[]; primaryBranchId: string }>>({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [branchPage, unitPage, userPage, assignmentPage] = await Promise.all([
        canReadBranches ? apiRequest<PageResult<Branch>>('/branches?pageSize=200') : Promise.resolve({ items: [], pagination: { total: 0 } }),
        canReadUnits ? apiRequest<PageResult<Unit>>('/organization-units?pageSize=200') : Promise.resolve({ items: [], pagination: { total: 0 } }),
        canReadUsers ? apiRequest<PageResult<UserRow>>('/access/users?pageSize=200') : Promise.resolve({ items: [], pagination: { total: 0 } }),
        canReadAssignments ? apiRequest<PageResult<Assignment>>('/assignments?pageSize=200') : Promise.resolve({ items: [], pagination: { total: 0 } }),
      ]);
      setBranches(branchPage.items); setUnits(unitPage.items); setUsers(userPage.items); setAssignments(assignmentPage.items);
      setBranchMembers(Object.fromEntries(branchPage.items.map((branch) => [branch.id, branch.members.map(({ userId }) => userId)])));
      setUnitMembers(Object.fromEntries(unitPage.items.map((unit) => [unit.id, unit.memberships.map(({ userId }) => userId)])));
      setUserBranches(Object.fromEntries(userPage.items.map((row) => {
        const assignments = branchPage.items.flatMap((branch) => branch.members.filter((member) => member.userId === row.id).map((member) => ({ branchId: branch.id, isPrimary: member.isPrimary })));
        return [row.id, { branchIds: assignments.map((item) => item.branchId), primaryBranchId: assignments.find((item) => item.isPrimary)?.branchId ?? assignments[0]?.branchId ?? '' }];
      })));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Organization data could not be loaded.');
    }
  }, [canReadBranches, canReadUnits, canReadUsers, canReadAssignments]);
  useEffect(() => { void load(); }, [load]);

  async function mutate(event: FormEvent<HTMLFormElement>, url: string, success: string) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const values: Record<string, unknown> = Object.fromEntries(form.entries());
    if (url === '/assignments') {
      values.branchId = values.branchId || null;
      values.dueAt = values.dueAt ? new Date(String(values.dueAt)).toISOString() : null;
    }
    if (url === '/branches') Object.assign(values, branchValues(form));
    if (url === '/organization-units') Object.assign(values, unitValues(form));
    try {
      await apiRequest(url, { method: 'POST', body: JSON.stringify(values) });
      setNotice(success); formElement.reset(); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The organization record could not be saved.'); }
    finally { setBusy(false); }
  }

  async function saveBranch(event: FormEvent<HTMLFormElement>, branch: Branch) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const formElement = event.currentTarget;
    try {
      const values = branchValues(new FormData(formElement));
      if (values.status === 'ARCHIVED' && branch.status !== 'ARCHIVED' && !window.confirm(`Archive ${branch.name}? Existing data will remain in the organization.`)) return;
      await apiRequest(`/branches/${branch.id}`, { method: 'PATCH', body: JSON.stringify(values) });
      setNotice('Branch details were updated.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Branch details could not be saved.'); }
    finally { setBusy(false); }
  }

  async function saveOrganizationUnit(event: FormEvent<HTMLFormElement>, unit: Unit) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const formElement = event.currentTarget;
    try {
      const values = unitValues(new FormData(formElement));
      await apiRequest(`/organization-units/${unit.id}`, { method: 'PATCH', body: JSON.stringify({ ...values, active: values.active === 'true' }) });
      setNotice('Organization unit details were updated.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Organization unit details could not be saved.'); }
    finally { setBusy(false); }
  }

  async function saveUnitMembers(unitId: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/organization-units/${unitId}/users`, { method: 'PUT', body: JSON.stringify({ userIds: unitMembers[unitId] ?? [] }) });
      setNotice('Department or group membership was updated.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Unit membership could not be updated.'); }
    finally { setBusy(false); }
  }

  async function saveAssignment(event: FormEvent<HTMLFormElement>, assignment: Assignment) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const form = new FormData(event.currentTarget);
    const dueAt = String(form.get('dueAt') ?? '');
    try {
      await apiRequest(`/assignments/${assignment.id}`, { method: 'PATCH', body: JSON.stringify({ status: String(form.get('status')), dueAt: dueAt ? new Date(dueAt).toISOString() : null }) });
      setNotice('Assignment status and due date were updated.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Assignment could not be updated.'); }
    finally { setBusy(false); }
  }

  async function saveUserBranches(userId: string) {
    const selected = userBranches[userId];
    if (!selected?.branchIds.length || !selected.primaryBranchId) { setError('Assign at least one branch and select the primary branch.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/access/users/${userId}/branches`, { method: 'PUT', body: JSON.stringify(selected) });
      setNotice('User branch access was updated. Existing sessions were revoked.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Branch access could not be updated.'); }
    finally { setBusy(false); }
  }

  async function saveBranchMembers(branchId: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/branches/${branchId}/users`, { method: 'PUT', body: JSON.stringify({ userIds: branchMembers[branchId] ?? [] }) });
      setNotice('Branch membership was updated.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Branch membership could not be updated.'); }
    finally { setBusy(false); }
  }

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">TENANT ORGANIZATION</p><h1>Branches and assignments</h1><p className="muted">Manage locations, departments, access scope, and user assignments in this workspace.</p></div><span className="heading-count"><Building2 size={16} /> Tenant scoped</span></div>
    {notice && <div className="notice notice-success" role="status"><Check size={16} /> {notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}

    {canReadBranches && <section className="surface-panel"><div className="section-heading section-heading-panel"><div><h2>Branches</h2><p>Locations and active user memberships.</p></div><GitBranch size={18} /></div>
      {canManageBranches && <form className="platform-form organization-branch-create" onSubmit={(event) => void mutate(event, '/branches', 'Branch created.')}>
        <h3>Add a branch</h3>
        <div className="platform-form-grid">
          <label>Branch code<input name="code" required maxLength={48} autoComplete="off" /></label>
          <label>Branch name<input name="name" required maxLength={160} /></label>
          <label>Branch manager<select name="managerId" defaultValue=""><option value="">Unassigned</option>{users.filter((row) => row.status === 'ACTIVE').map((row) => <option key={row.id} value={row.id}>{row.firstName} {row.lastName ?? ''} · {row.email}</option>)}</select></label>
          <label>Contact email<input name="email" type="email" maxLength={254} /></label>
          <label>Contact phone<input name="phone" maxLength={32} /></label>
          <label>Capacity<input name="capacity" type="number" min={1} step={1} /></label>
          <label>Address<input name="addressLine1" maxLength={200} autoComplete="street-address" /></label>
          <label>City<input name="addressCity" maxLength={100} autoComplete="address-level2" /></label>
        </div>
        <button className="button button-primary button-small" disabled={busy}>Create branch</button>
      </form>}
      {branches.length ? <div className="table-wrap"><table><thead><tr><th>Branch</th><th>Status</th><th>Manager</th><th>Members</th><th>Branch details</th><th>Manage membership</th></tr></thead><tbody>{branches.map((branch) => <tr key={branch.id}>
        <td><strong>{branch.name}</strong><small className="table-subtext">{branch.code}</small></td>
        <td><span className={`status-pill ${branch.status === 'ACTIVE' ? 'status-green' : branch.status === 'ARCHIVED' ? 'status-red' : 'status-amber'}`}>{branch.status}</span></td>
        <td>{branch.manager?.email ?? 'Unassigned'}</td><td>{branch.memberCount}</td>
        <td>{canManageBranches ? <details className="organization-branch-edit"><summary className="text-button">Edit branch</summary><form className="platform-form" onSubmit={(event) => void saveBranch(event, branch)} key={`${branch.id}-${branch.status}-${branch.updatedAt ?? ''}`}>
          <div className="platform-form-grid">
            <label>Branch code<input name="code" required maxLength={48} defaultValue={branch.code} /></label>
            <label>Branch name<input name="name" required maxLength={160} defaultValue={branch.name} /></label>
            <label>Status<select name="status" defaultValue={branch.status}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ARCHIVED">Archived</option></select></label>
            <label>Branch manager<select name="managerId" defaultValue={branch.managerId ?? ''}><option value="">Unassigned</option>{users.filter((row) => row.status === 'ACTIVE').map((row) => <option key={row.id} value={row.id}>{row.firstName} {row.lastName ?? ''} · {row.email}</option>)}</select></label>
            <label>Contact email<input name="email" type="email" maxLength={254} defaultValue={branch.email ?? ''} /></label>
            <label>Contact phone<input name="phone" maxLength={32} defaultValue={branch.phone ?? ''} /></label>
            <label>Capacity<input name="capacity" type="number" min={1} step={1} defaultValue={branch.capacity ?? ''} /></label>
            <label>Address<input name="addressLine1" maxLength={200} defaultValue={String(branch.address?.line1 ?? '')} /></label>
            <label>City<input name="addressCity" maxLength={100} defaultValue={String(branch.address?.city ?? '')} /></label>
          </div>
          <button className="button button-secondary button-small" disabled={busy}>Save branch</button>
        </form></details> : '—'}</td>
        <td>{canManageBranches && branch.status === 'ACTIVE' ? canReadUsers ? <div className="organization-members"><select multiple aria-label={`Users in ${branch.name}`} size={Math.min(Math.max(users.length, 2), 5)} value={branchMembers[branch.id] ?? []} onChange={(event) => setBranchMembers((state) => ({ ...state, [branch.id]: [...event.currentTarget.selectedOptions].map((option) => option.value) }))}>{users.filter((row) => row.status === 'ACTIVE').map((row) => <option key={row.id} value={row.id}>{row.firstName} {row.lastName ?? ''} · {row.email}</option>)}</select><button className="button button-secondary button-small" disabled={busy} onClick={() => void saveBranchMembers(branch.id)}>Save</button></div> : <small>User read permission is required to edit membership.</small> : '—'}</td>
      </tr>)}</tbody></table></div> : <p className="empty-inline">No branches are available.</p>}
    </section>}

    {canManageBranches && canManageAllUserAccess && canReadUsers && <section className="surface-panel"><div className="section-heading section-heading-panel"><div><h2>User branch access</h2><p>Choose a user’s allowed locations and primary branch. Saving revokes their existing sessions.</p></div><UsersRound size={18} /></div>
      {users.filter((row) => row.status === 'ACTIVE').length ? <div className="table-wrap"><table><thead><tr><th>User</th><th>Branches</th><th>Primary branch</th><th /></tr></thead><tbody>{users.filter((row) => row.status === 'ACTIVE').map((row) => { const value = userBranches[row.id] ?? { branchIds: [], primaryBranchId: '' }; return <tr key={row.id}><td><strong>{row.firstName} {row.lastName ?? ''}</strong><small className="table-subtext">{row.email}</small></td><td><select multiple aria-label={`Allowed branches for ${row.email}`} size={Math.min(Math.max(branches.length, 2), 5)} value={value.branchIds} onChange={(event) => { const branchIds = [...event.currentTarget.selectedOptions].map((option) => option.value); setUserBranches((state) => ({ ...state, [row.id]: { branchIds, primaryBranchId: branchIds.includes(value.primaryBranchId) ? value.primaryBranchId : branchIds[0] ?? '' } })); }}>{branches.filter((branch) => branch.status === 'ACTIVE').map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></td><td><select aria-label={`Primary branch for ${row.email}`} value={value.primaryBranchId} onChange={(event) => setUserBranches((state) => ({ ...state, [row.id]: { ...value, primaryBranchId: event.target.value } }))}><option value="">Choose branch</option>{value.branchIds.map((id) => branches.find((branch) => branch.id === id)).filter((branch): branch is Branch => Boolean(branch)).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></td><td><button className="button button-secondary button-small" disabled={busy} onClick={() => void saveUserBranches(row.id)}>Save access</button></td></tr>; })}</tbody></table></div> : <p className="empty-inline">Active user accounts are required to assign branches.</p>}
    </section>}

    {canReadUnits && <section className="surface-panel"><div className="section-heading section-heading-panel"><div><h2>Departments and groups</h2><p>Build a tenant-owned hierarchy and assign active users to departments, teams, or groups.</p></div></div>
      {canManageUnits && <form className="platform-form organization-branch-create" onSubmit={(event) => void mutate(event, '/organization-units', 'Organization unit created.')}><h3>Add an organization unit</h3><div className="platform-form-grid"><label>Unit type<input name="unitType" required maxLength={80} placeholder="Department" /></label><label>Code<input name="code" required maxLength={48} /></label><label>Name<input name="name" required maxLength={160} /></label><label>Parent unit<select name="parentId" defaultValue=""><option value="">Top-level unit</option>{units.filter((unit) => unit.active).map((unit) => <option key={unit.id} value={unit.id}>{unit.name} · {unit.unitType}</option>)}</select></label><label>Description<input name="description" maxLength={1000} /></label></div><button className="button button-primary button-small" disabled={busy}>Add unit</button></form>}
      {units.length ? <div className="table-wrap"><table><thead><tr><th>Unit</th><th>Type</th><th>Parent</th><th>Members</th><th>Status</th><th>Manage</th></tr></thead><tbody>{units.map((unit) => <tr key={unit.id}><td><strong>{unit.name}</strong><small className="table-subtext">{unit.code}</small></td><td>{unit.unitType}</td><td>{units.find((item) => item.id === unit.parentId)?.name ?? 'Top level'}</td><td>{unit.memberCount}</td><td><span className={`status-pill ${unit.active ? 'status-green' : 'status-amber'}`}>{unit.active ? 'Active' : 'Inactive'}</span></td><td>{canManageUnits ? <details className="organization-branch-edit"><summary className="text-button">Edit unit and members</summary><form className="platform-form" onSubmit={(event) => void saveOrganizationUnit(event, unit)} key={`${unit.id}-${unit.active}`}><div className="platform-form-grid"><label>Unit type<input name="unitType" required maxLength={80} defaultValue={unit.unitType} /></label><label>Code<input name="code" required maxLength={48} defaultValue={unit.code} /></label><label>Name<input name="name" required maxLength={160} defaultValue={unit.name} /></label><label>Parent unit<select name="parentId" defaultValue={unit.parentId ?? ''}><option value="">Top-level unit</option>{units.filter((item) => item.id === unit.parentId || (item.active && item.id !== unit.id && !descendantUnitIds(units, unit.id).has(item.id))).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.unitType}{item.active ? '' : ' · Inactive'}</option>)}</select></label><label>Description<input name="description" maxLength={1000} defaultValue={unit.description ?? ''} /></label><label>Status<select name="active" defaultValue={unit.active ? 'true' : 'false'}><option value="true">Active</option><option value="false">Inactive</option></select></label></div><button className="button button-secondary button-small" disabled={busy}>Save unit</button></form>{unit.active ? canReadUsers ? <div className="organization-members"><label>Unit members<select multiple aria-label={`Users in ${unit.name}`} size={Math.min(Math.max(users.length, 2), 5)} value={unitMembers[unit.id] ?? []} onChange={(event) => setUnitMembers((state) => ({ ...state, [unit.id]: [...event.currentTarget.selectedOptions].map((option) => option.value) }))}>{users.filter((row) => row.status === 'ACTIVE').map((row) => <option key={row.id} value={row.id}>{row.firstName} {row.lastName ?? ''} · {row.email}</option>)}</select></label><button className="button button-secondary button-small" disabled={busy} onClick={() => void saveUnitMembers(unit.id)}>Save members</button></div> : <small>User read permission is required to edit membership.</small> : null}</details> : '—'}</td></tr>)}</tbody></table></div> : <p className="empty-inline">No departments or groups have been created.</p>}
    </section>}

    {canReadAssignments && <section className="surface-panel"><div className="section-heading section-heading-panel"><div><h2>User assignments</h2><p>Track tenant-owned responsibilities or resources assigned to a user.</p></div></div>
      {canManageAssignments && <form className="platform-filter-grid" onSubmit={(event) => void mutate(event, '/assignments', 'Assignment created.')}><label>User<select name="userId" required defaultValue=""><option value="">Choose user</option>{users.filter((row) => row.status === 'ACTIVE').map((row) => <option key={row.id} value={row.id}>{row.firstName} {row.lastName ?? ''} · {row.email}</option>)}</select></label><label>Branch<select name="branchId" defaultValue=""><option value="">Organization-wide</option>{branches.filter((branch) => branch.status === 'ACTIVE').map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><label>Resource type<input name="resourceType" required maxLength={80} placeholder="TRAINING" /></label><label>Resource ID<input name="resourceId" required maxLength={200} /></label><label>Label<input name="resourceLabel" maxLength={200} /></label><label>Due date<input name="dueAt" type="datetime-local" /></label><button className="button button-primary button-small" disabled={busy}>Assign resource</button></form>}
      {assignments.length ? <div className="table-wrap"><table><thead><tr><th>Assignment</th><th>User</th><th>Branch</th><th>Status</th><th>Due</th><th>Manage</th></tr></thead><tbody>{assignments.map((item) => { const assignee = users.find((row) => row.id === item.userId); return <tr key={item.id}><td><strong>{item.resourceLabel ?? item.resourceType}</strong><small className="table-subtext">{item.resourceType} · {item.resourceId}</small></td><td>{assignee ? `${assignee.firstName} ${assignee.lastName ?? ''}` : 'User'}</td><td>{branches.find((row) => row.id === item.branchId)?.name ?? 'Organization-wide'}</td><td>{item.status}</td><td>{item.dueAt ? formatIndianDate(new Date(item.dueAt)) : '—'}</td><td>{canManageAssignments ? <details className="organization-branch-edit"><summary className="text-button">Edit assignment</summary><form className="platform-form" onSubmit={(event) => void saveAssignment(event, item)}><div className="platform-form-grid"><label>Status<select name="status" defaultValue={item.status}><option value="ASSIGNED">Assigned</option><option value="STARTED">Started</option><option value="IN_PROGRESS">In progress</option><option value="COMPLETED">Completed</option><option value="OVERDUE">Overdue</option><option value="CANCELLED">Cancelled</option></select></label><label>Due date<input name="dueAt" type="datetime-local" defaultValue={dateTimeLocalValue(item.dueAt)} /></label></div><button className="button button-secondary button-small" disabled={busy}>Save assignment</button></form></details> : '—'}</td></tr>; })}</tbody></table></div> : <p className="empty-inline">No assignments are listed.</p>}
    </section>}

    {!canReadBranches && !canReadUnits && !canReadAssignments && <div className="notice notice-error" role="alert">Your role does not have access to organization management.</div>}
  </main>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }

function branchValues(form: FormData): Record<string, unknown> {
  const text = (key: string) => String(form.get(key) ?? '').trim();
  const address = {
    ...(text('addressLine1') ? { line1: text('addressLine1') } : {}),
    ...(text('addressCity') ? { city: text('addressCity') } : {}),
  };
  return {
    code: text('code').toUpperCase(),
    name: text('name'),
    status: text('status') || undefined,
    managerId: text('managerId') || null,
    email: text('email') || null,
    phone: text('phone') || null,
    capacity: text('capacity') ? Number(text('capacity')) : null,
    address: Object.keys(address).length ? address : null,
  };
}

function unitValues(form: FormData): Record<string, unknown> {
  const text = (key: string) => String(form.get(key) ?? '').trim();
  return {
    code: text('code').toUpperCase(),
    name: text('name'),
    unitType: text('unitType').toUpperCase(),
    description: text('description') || null,
    parentId: text('parentId') || null,
    active: text('active') || undefined,
  };
}

function descendantUnitIds(units: Unit[], unitId: string): Set<string> {
  const descendants = new Set<string>();
  const pending = units.filter((unit) => unit.parentId === unitId).map((unit) => unit.id);
  while (pending.length) {
    const childId = pending.pop()!;
    if (descendants.has(childId)) continue;
    descendants.add(childId);
    pending.push(...units.filter((unit) => unit.parentId === childId).map((unit) => unit.id));
  }
  return descendants;
}

function dateTimeLocalValue(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}
