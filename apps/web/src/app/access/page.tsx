'use client';
import { formatIndianDate, formatIndianDateTime } from '../../lib/locale';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { enumLabel } from '@fee/types';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { buildImportPreview } from '../../lib/user-import';
import { useSession } from '../../components/session-provider';
import { Check, Download, ShieldCheck, Upload, UserPlus, UsersRound } from 'lucide-react';

interface Role { id: string; key: string; name: string; description: string | null; isSystem: boolean; active: boolean; permissionsConfigured: boolean; permissionKeys: string[] }
interface Permission { id: string; key: string; resource: string; action: string; description: string | null; sensitive: boolean }
interface PermissionGroup { group: string; permissions: string[] }
interface UserRow {
  id: string; email: string; phone: string | null; firstName: string; lastName: string | null; status: string; mustChangePassword: boolean; studentId: string | null; guardianId: string | null;
  lastLoginAt: string | null; createdAt: string; invitationExpiresAt: string | null; emailVerifiedAt: string | null; userRoles: Array<{ role: { id: string; key: string; name: string } }>;
  branches: Array<{ id: string; code: string; name: string; isPrimary: boolean }>;
  organizationUnits: Array<{ id: string; code: string; name: string; unitType: string }>;
}
interface PortalSubjects { students: Array<{ id: string; admissionNumber: string; firstName: string; middleName: string | null; lastName: string | null }>; guardians: Array<{ id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null }>; persons: Array<{ id: string; personNumber: string; typeLabel: string; firstName: string; middleName: string | null; lastName: string | null; email: string | null; branchId: string | null }> }
interface Branch { id: string; code: string; name: string; status: string }
interface OrganizationUnit { id: string; code: string; name: string; unitType: string; active: boolean }
interface PageResult<T> { items: T[]; pagination: { total: number } }

export default function AccessPage() {
  const { user } = useSession();
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [permissionGroups, setPermissionGroups] = useState<PermissionGroup[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [portalSubjects, setPortalSubjects] = useState<PortalSubjects>({ students: [], guardians: [], persons: [] });
  const [branches, setBranches] = useState<Branch[]>([]);
  const [organizationUnits, setOrganizationUnits] = useState<OrganizationUnit[]>([]);
  const [createRoleIds, setCreateRoleIds] = useState<string[]>([]);
  const [createBranchIds, setCreateBranchIds] = useState<string[]>([]);
  const [createPrimaryBranchId, setCreatePrimaryBranchId] = useState('');
  const [createOrganizationUnitIds, setCreateOrganizationUnitIds] = useState<string[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [selectedPermissionKeys, setSelectedPermissionKeys] = useState<string[]>([]);
  const [userRoleSelections, setUserRoleSelections] = useState<Record<string, string[]>>({});
  const [userBranchSelections, setUserBranchSelections] = useState<Record<string, string[]>>({});
  const [userUnitSelections, setUserUnitSelections] = useState<Record<string, string[]>>({});
  const [importText, setImportText] = useState('');
  const [importFilename, setImportFilename] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const hasLoadedRef = useRef(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [initialLoadFailed, setInitialLoadFailed] = useState(false);
  const canReadUsers = hasPermission(user, 'user.read');
  const canCreateUsers = hasPermission(user, 'user.create') && hasPermission(user, 'role.assign');
  const canDisableUsers = hasPermission(user, 'user.disable');
  const canAssignRoles = hasPermission(user, 'role.assign');
  const canReadRoles = hasPermission(user, 'role.read');
  const canReadPermissions = hasPermission(user, 'permission.read');
  const canManageTenantRoles = Boolean(user?.roles.some((role) => role === 'TENANT_ADMIN' || role === 'TENANT_OWNER'));
  const canReadBranches = hasPermission(user, 'branch.read');
  const canReadOrganizationUnits = hasPermission(user, 'organization.unit.read');
  const canManageBranchScope = canManageTenantRoles && hasPermission(user, 'branch.manage');
  const canManageOrganizationUnitScope = canManageTenantRoles && hasPermission(user, 'organization.unit.manage');

  const load = useCallback(async () => {
    const isInitialLoad = !hasLoadedRef.current;
    if (isInitialLoad) { setInitialLoading(true); setInitialLoadFailed(false); }
    setError('');
    try {
      const [userPage, roleRows, catalog, subjects, branchPage, unitPage] = await Promise.all([
        canReadUsers ? apiRequest<PageResult<UserRow>>('/access/users?pageSize=200') : Promise.resolve({ items: [], pagination: { total: 0 } }),
        canReadRoles ? apiRequest<Role[]>('/access/roles') : Promise.resolve([]),
        canReadPermissions ? apiRequest<{ groups: PermissionGroup[]; permissions: Permission[] }>('/access/permissions') : Promise.resolve({ groups: [], permissions: [] }),
        canCreateUsers ? apiRequest<PortalSubjects>('/access/portal-subjects') : Promise.resolve({ students: [], guardians: [], persons: [] } as PortalSubjects),
        canReadBranches ? apiRequest<PageResult<Branch>>('/branches?pageSize=200&status=ACTIVE') : Promise.resolve({ items: [], pagination: { total: 0 } }),
        canReadOrganizationUnits ? apiRequest<PageResult<OrganizationUnit>>('/organization-units?pageSize=200') : Promise.resolve({ items: [], pagination: { total: 0 } }),
      ]);
      const activeBranches = branchPage.items.filter((branch) => branch.status === 'ACTIVE');
      const activeUnits = unitPage.items.filter((unit) => unit.active);
      setUsers(userPage.items); setRoles(roleRows); setPermissionGroups(catalog.groups); setPermissions(catalog.permissions); setPortalSubjects(subjects); setBranches(activeBranches); setOrganizationUnits(activeUnits);
      setUserRoleSelections(Object.fromEntries(userPage.items.map((row) => [row.id, row.userRoles.map((link) => link.role.id)])));
      setUserBranchSelections(Object.fromEntries(userPage.items.map((row) => [row.id, row.branches.map((branch) => branch.id)])));
      setUserUnitSelections(Object.fromEntries(userPage.items.map((row) => [row.id, row.organizationUnits.map((unit) => unit.id)])));
      setSelectedRoleId((current) => roleRows.some((role) => role.id === current) ? current : roleRows[0]?.id ?? '');
      setCreateBranchIds((current) => current.length ? current.filter((id) => activeBranches.some((branch) => branch.id === id)) : activeBranches.slice(0, 1).map((branch) => branch.id));
      setCreatePrimaryBranchId((current) => activeBranches.some((branch) => branch.id === current) ? current : activeBranches[0]?.id ?? '');
      hasLoadedRef.current = true;
    } catch (cause) {
      if (isInitialLoad) setInitialLoadFailed(true);
      setError(cause instanceof ApiError ? cause.message : 'User and role records could not be loaded.');
    } finally {
      if (isInitialLoad) setInitialLoading(false);
    }
  }, [canReadUsers, canReadRoles, canReadPermissions, canCreateUsers, canReadBranches, canReadOrganizationUnits]);
  useEffect(() => { void load(); }, [load]);

  const selectedRole = roles.find((role) => role.id === selectedRoleId);
  const selectedCreateRoleKeys = roles.filter((role) => createRoleIds.includes(role.id)).map((role) => role.key);
  const importPreview = useMemo(() => buildImportPreview(importText, roles, branches, organizationUnits), [importText, roles, branches, organizationUnits]);
  useEffect(() => { setSelectedPermissionKeys(selectedRole?.permissionKeys ?? []); }, [selectedRoleId, selectedRole?.permissionKeys.join('|')]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const result = await apiRequest<{ firstName: string; email: string; invitationExpiresAt: string }>('/access/users', { method: 'POST', body: JSON.stringify({
        firstName: form.get('firstName'), lastName: form.get('lastName') || null, email: form.get('email'), phone: form.get('phone') || null,
        roleIds: form.getAll('roleIds'),
        branchIds: createBranchIds, primaryBranchId: createPrimaryBranchId || null, organizationUnitIds: createOrganizationUnitIds,
        studentId: form.get('studentId') || null, guardianId: form.get('guardianId') || null,
        tenantPersonId: form.get('tenantPersonId') || null,
      }) });
      setNotice(`User added. An activation link was queued for ${result.firstName} (${result.email}) and expires ${formatIndianDateTime(new Date(result.invitationExpiresAt))}.`);
      formElement.reset(); setCreateRoleIds([]); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The user account could not be created.'); }
    finally { setBusy(false); }
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    setError(''); setNotice('');
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setImportText(''); setImportFilename(''); setError('Choose a CSV file smaller than 2 MB.'); return; }
    if (!file.name.toLowerCase().endsWith('.csv')) { setImportText(''); setImportFilename(''); setError('Bulk user import accepts CSV files.'); return; }
    try { setImportText(await file.text()); setImportFilename(file.name); }
    catch { setImportText(''); setImportFilename(''); setError('The selected CSV file could not be read.'); }
  }

  async function importUsers() {
    if (importPreview.globalError || !importPreview.rows.length || importPreview.rows.some((row) => row.errors.length)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ count: number }>('/access/users/bulk-invitations', { method: 'POST', body: JSON.stringify({ users: importPreview.rows.map(({ firstName, lastName, email, phone, roleIds, branchIds, organizationUnitIds, personNumber }) => ({ firstName, lastName, email, phone, roleIds, branchIds, primaryBranchId: branchIds[0], organizationUnitIds, ...(personNumber ? { personNumber } : {}) })) }) });
      setNotice(`${result.count} users added. Secure activation links were queued for their email addresses.`);
      setImportText(''); setImportFilename(''); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The users could not be imported. No users were added.'); }
    finally { setBusy(false); }
  }

  function downloadImportTemplate() {
    const content = 'firstName,lastName,email,phone,roleKeys,branchCodes,organizationUnitCodes,personNumber\n';
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'wasl-user-import-template.csv'; link.click(); URL.revokeObjectURL(url);
  }

  async function saveUserBranches(row: UserRow) {
    const branchIds = userBranchSelections[row.id] ?? [];
    if (!branchIds.length) { setError('Assign every user to at least one active branch.'); return; }
    const primaryBranchId = row.branches.find((branch) => branch.isPrimary && branchIds.includes(branch.id))?.id ?? branchIds[0]!;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/access/users/${row.id}/branches`, { method: 'PUT', body: JSON.stringify({ branchIds, primaryBranchId }) });
      setNotice(`Branch access updated for ${row.email}. Their existing sessions were signed out.`); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Branch access could not be updated.'); }
    finally { setBusy(false); }
  }

  async function saveUserOrganizationUnits(row: UserRow) {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/access/users/${row.id}/organization-units`, { method: 'PUT', body: JSON.stringify({ unitIds: userUnitSelections[row.id] ?? [] }) });
      setNotice(`Group access updated for ${row.email}. Their existing sessions were signed out.`); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Group access could not be updated.'); }
    finally { setBusy(false); }
  }

  async function saveRolePermissions() {
    if (!selectedRole) return; setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/access/roles/${selectedRole.id}/permissions`, { method: 'PATCH', body: JSON.stringify({ permissionKeys: selectedPermissionKeys }) });
      setNotice(`Permissions saved for ${selectedRole.name}. Members need to sign in again to receive the updated role access.`); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Role permissions could not be saved.'); }
    finally { setBusy(false); }
  }

  async function saveUserRoles(userId: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/access/users/${userId}/roles`, { method: 'PATCH', body: JSON.stringify({ roleIds: userRoleSelections[userId] ?? [] }) });
      setNotice('User roles saved. The user must sign in again to load the updated access.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'User roles could not be saved.'); }
    finally { setBusy(false); }
  }

  async function changeStatus(row: UserRow, status: 'ACTIVE' | 'SUSPENDED' | 'DISABLED') {
    setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/access/users/${row.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setNotice(`${row.email} is now ${status.toLowerCase()}.`); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The account status could not be changed.'); }
    finally { setBusy(false); }
  }

  async function resendInvitation(row: UserRow) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ invitationExpiresAt: string }>(`/access/users/${row.id}/invitation`, { method: 'POST' });
      setNotice(`A new invitation was queued for ${row.email}; the previous link was revoked. It expires ${formatIndianDateTime(new Date(result.invitationExpiresAt))}.`);
      await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The invitation could not be resent.'); }
    finally { setBusy(false); }
  }

  async function saveUserProfile(event: FormEvent<HTMLFormElement>, userId: string) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const form = new FormData(event.currentTarget);
    try {
      await apiRequest(`/access/users/${userId}`, { method: 'PATCH', body: JSON.stringify({
        firstName: form.get('firstName'), lastName: form.get('lastName') || null, phone: form.get('phone') || null,
      }) });
      setNotice('User profile updated. Email changes must be verified from the user’s own profile.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The user profile could not be updated.'); }
    finally { setBusy(false); }
  }

  async function sendPasswordReset(row: UserRow) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ expiresAt: string }>(`/access/users/${row.id}/password-reset-link`, { method: 'POST' });
      setNotice(`A one-time reset link was queued for ${row.email}; it expires ${formatIndianDateTime(new Date(result.expiresAt))}.`); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The password could not be reset.'); }
    finally { setBusy(false); }
  }

  async function createRole(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const role = await apiRequest<Role>('/access/roles', { method: 'POST', body: JSON.stringify({
        key: String(values.get('key') ?? '').trim().toUpperCase(),
        name: String(values.get('name') ?? '').trim(),
        description: String(values.get('description') ?? '').trim() || null,
        permissionKeys: [],
      }) });
      form.reset(); await load(); setSelectedRoleId(role.id); setSelectedPermissionKeys(role.permissionKeys ?? []);
      setNotice(`Role “${role.name}” created. Select its permissions and save the role.`);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The role could not be created.'); }
    finally { setBusy(false); }
  }

  async function updateRole(event: FormEvent<HTMLFormElement>, role: Role) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const values = new FormData(event.currentTarget);
    try {
      await apiRequest(`/access/roles/${role.id}`, { method: 'PATCH', body: JSON.stringify({
        name: String(values.get('name') ?? '').trim(),
        description: String(values.get('description') ?? '').trim() || null,
        active: values.get('active') === 'on',
      }) });
      setNotice(`Role “${role.name}” updated.`); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The role could not be updated.'); }
    finally { setBusy(false); }
  }

  if (!canReadUsers && !canReadRoles && !canReadPermissions) return <main id="main-content" className="page-content"><div className="page-heading"><div><p className="eyebrow">SECURITY</p><h1>Users and roles</h1></div></div><div className="notice notice-error" role="alert">Your role does not have access to user or role administration.</div></main>;

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">SECURITY</p><h1>Users and roles</h1><p className="muted">Manage organization accounts, role membership, and permission grants.</p></div><span className="heading-count"><ShieldCheck size={16} /> Organization scoped</span></div>
    {notice && <div className="notice notice-success" role="status"><Check size={16} /> {notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    {initialLoading ? <div className="loading-page" role="status">Loading users, roles, and access scopes…</div>
      : initialLoadFailed ? <div className="empty-state"><span className="empty-icon"><ShieldCheck /></span><h2>Workspace access could not be loaded</h2><p>Check your connection, then retry. No user or role changes were made.</p><button className="button button-secondary" onClick={() => void load()}>Try again</button></div>
      : <div className="access-layout">
      {canReadRoles && canReadPermissions && <section className="surface-panel role-editor-panel"><div className="section-heading section-heading-panel"><div><h2>Role permissions</h2><p>Untouched system roles use the default permission matrix. Saving makes the displayed grants explicit.</p></div></div>
        {roles.length ? <><label className="access-picker">Role<select value={selectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value)}>{roles.map((role) => <option value={role.id} key={role.id}>{role.name}{role.isSystem ? ' · system' : ''}</option>)}</select></label>
          {selectedRole && <div className="permission-groups">{permissionGroups.map((group) => <fieldset key={group.group} className="permission-group"><legend>{group.group}</legend>{group.permissions.map((key) => {
            const permission = permissions.find((entry) => entry.key === key);
            const checked = selectedPermissionKeys.includes(key);
            return <label key={key} className="permission-check"><input type="checkbox" checked={checked} disabled={!canAssignRoles} onChange={(event) => setSelectedPermissionKeys((current) => event.target.checked ? [...current, key] : current.filter((entry) => entry !== key))} /><span><strong>{enumLabel(key)}</strong><small>{permission?.description ?? key}{permission?.sensitive ? ' · approval-sensitive' : ''}</small></span></label>;
          })}</fieldset>)}</div>}
          {canAssignRoles && <div className="access-save-row"><span className="muted">{selectedPermissionKeys.length} permission grants</span><button className="button button-primary" onClick={() => void saveRolePermissions()} disabled={busy}>Save permissions</button></div>}
          {selectedRole && canAssignRoles && canManageTenantRoles && !selectedRole.isSystem && <details className="platform-user-edit"><summary>Edit role details</summary><form className="platform-form" onSubmit={(event) => void updateRole(event, selectedRole)}><label>Role name<input name="name" required maxLength={120} defaultValue={selectedRole.name} /></label><label>Description<input name="description" maxLength={500} defaultValue={selectedRole.description ?? ''} /></label><label className="platform-checkbox-label"><input name="active" type="checkbox" defaultChecked={selectedRole.active} /> Role is active</label><button className="button button-secondary button-small" disabled={busy}>Save role details</button></form></details>}
          {canAssignRoles && canManageTenantRoles && <details className="platform-user-edit"><summary>Create a custom role</summary><form className="platform-form" onSubmit={(event) => void createRole(event)}><label>Role key<input name="key" required minLength={2} maxLength={80} pattern="[A-Za-z][A-Za-z0-9_]*" placeholder="BRANCH_COORDINATOR" /></label><label>Role name<input name="name" required maxLength={120} /></label><label>Description<input name="description" maxLength={500} /></label><button className="button button-secondary button-small" disabled={busy}>Create role</button></form><small>New custom roles start with no permissions. Grant only the access they need above.</small></details>}
        </> : <div className="empty-state"><span className="empty-icon"><ShieldCheck /></span><h2>No tenant roles</h2><p>Default roles are created when the organization is provisioned.</p></div>}
      </section>}

      <div className="access-right-column">
        {canCreateUsers && canReadRoles && <section className="surface-panel user-create-panel">
          <div className="section-heading section-heading-panel"><div><h2>Add a user</h2><p>We create the account and email a secure activation link. The user sets their own password.</p></div><UserPlus size={18} /></div>
          <form className="access-user-form" onSubmit={createUser}>
            <label>First name<input name="firstName" required maxLength={120} /></label><label>Last name <span className="muted">(optional)</span><input name="lastName" maxLength={120} /></label>
            <label>Email<input name="email" type="email" required maxLength={254} /></label><label>Phone <span className="muted">(optional)</span><input name="phone" maxLength={32} /></label>
            <label className="wide-field">Roles<select name="roleIds" multiple required value={createRoleIds} onChange={(event) => setCreateRoleIds([...event.currentTarget.selectedOptions].map((option) => option.value))} size={Math.min(Math.max(roles.length, 2), 6)}>{roles.filter((role) => role.active).map((role) => <option key={role.id} value={role.id}>{role.name} · {role.key}</option>)}</select><small>Choose only the access this person needs. Portal accounts that must link to another record are created individually.</small></label>
            {canReadBranches && branches.length > 0 && <label className="wide-field">Branch access<select multiple required value={createBranchIds} onChange={(event) => { const next = [...event.currentTarget.selectedOptions].map((option) => option.value); setCreateBranchIds(next); if (!next.includes(createPrimaryBranchId)) setCreatePrimaryBranchId(next[0] ?? ''); }} size={Math.min(Math.max(branches.length, 2), 5)}>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} · {branch.code}</option>)}</select><small>Users can access records only for their assigned branches.</small></label>}
            {canReadBranches && branches.length > 1 && <label className="wide-field">Primary branch<select required value={createPrimaryBranchId} onChange={(event) => setCreatePrimaryBranchId(event.target.value)}>{branches.filter((branch) => createBranchIds.includes(branch.id)).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
            {canReadOrganizationUnits && organizationUnits.length > 0 && <label className="wide-field">Departments or groups <span className="muted">(optional)</span><select multiple value={createOrganizationUnitIds} onChange={(event) => setCreateOrganizationUnitIds([...event.currentTarget.selectedOptions].map((option) => option.value))} size={Math.min(Math.max(organizationUnits.length, 2), 5)}>{organizationUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} · {unit.unitType}</option>)}</select></label>}
            {selectedCreateRoleKeys.includes('WORKSPACE_PERSON') && <label className="wide-field">Linked organisation person<select name="tenantPersonId" required defaultValue="" onChange={(event) => { const person = portalSubjects.persons.find((row) => row.id === event.target.value); if (person?.branchId) { setCreateBranchIds([person.branchId]); setCreatePrimaryBranchId(person.branchId); } }}><option value="">Choose a person without an account</option>{portalSubjects.persons.map((person) => <option key={person.id} value={person.id}>{person.personNumber} · {person.typeLabel} · {[person.firstName, person.middleName, person.lastName].filter(Boolean).join(' ')}{person.email ? ` · ${person.email}` : ' · Add email first'}</option>)}</select><small>They receive a secure activation email and can see only their own fee, payment, receipt, and attendance records.</small></label>}
            {selectedCreateRoleKeys.includes('STUDENT') && <label className="wide-field">Linked student<select name="studentId" required defaultValue=""><option value="">Choose student</option>{portalSubjects.students.map((student) => <option key={student.id} value={student.id}>{student.admissionNumber} · {[student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ')}</option>)}</select></label>}
            {selectedCreateRoleKeys.includes('PARENT') && <label className="wide-field">Linked guardian<select name="guardianId" required defaultValue=""><option value="">Choose guardian</option>{portalSubjects.guardians.map((guardian) => <option key={guardian.id} value={guardian.id}>{[guardian.firstName, guardian.lastName].filter(Boolean).join(' ')} · {guardian.email ?? guardian.phone ?? 'No contact'}</option>)}</select><small>A guardian must already be linked to at least one student.</small></label>}
            <button className="button button-primary wide-field" disabled={busy}><UserPlus size={15} /> {busy ? 'Adding user…' : 'Add user and send activation link'}</button>
          </form>
        </section>}

        {canCreateUsers && canReadRoles && <section className="surface-panel user-import-panel">
          <div className="section-heading section-heading-panel"><div><h2>Bulk import users</h2><p>Upload a CSV, review every row, then send secure activation links in one import.</p></div><Upload size={18} /></div>
          <div className="user-import-actions"><button type="button" className="button button-secondary button-small" onClick={downloadImportTemplate}><Download size={14} /> Download CSV template</button><label className="button button-secondary button-small import-file-button"><Upload size={14} /> Choose CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void handleImportFile(event)} /></label></div>
          <p className="muted">Columns: firstName, lastName, email, phone, roleKeys, branchCodes, organizationUnitCodes, personNumber. For Workspace Person accounts, include the matching profile number; the profile email must match the invite address.</p>
          {importFilename && <p className="user-import-filename">Reviewing <strong>{importFilename}</strong> · {importPreview.rows.length} rows</p>}
          {importPreview.globalError && <div className="notice notice-error" role="alert">{importPreview.globalError}</div>}
          {importPreview.rows.length > 0 && <>
            <div className="table-wrap user-import-preview"><table><thead><tr><th>CSV row</th><th>User</th><th>Roles</th><th>Branches / groups</th><th>Validation</th></tr></thead><tbody>{importPreview.rows.map((row) => <tr key={`${row.line}-${row.email}`}><td>{row.line}</td><td>{row.firstName} {row.lastName ?? ''}<small className="table-subtext">{row.email}</small>{row.personNumber && <small className="table-subtext">Profile {row.personNumber}</small>}</td><td>{row.roleIds.map((id) => roles.find((role) => role.id === id)?.name).filter(Boolean).join(', ') || '—'}</td><td>{row.branchIds.map((id) => branches.find((branch) => branch.id === id)?.name).join(', ') || '—'}{row.organizationUnitIds.length > 0 && <small className="table-subtext">{row.organizationUnitIds.map((id) => organizationUnits.find((unit) => unit.id === id)?.name).join(', ')}</small>}</td><td>{row.errors.length ? <span className="status-pill status-red">{row.errors.join(' · ')}</span> : <span className="status-pill status-green">Ready</span>}</td></tr>)}</tbody></table></div>
            <div className="access-save-row"><span className="muted">{importPreview.rows.filter((row) => !row.errors.length).length} ready · {importPreview.rows.filter((row) => row.errors.length).length} need correction</span><button className="button button-primary" onClick={() => void importUsers()} disabled={busy || Boolean(importPreview.globalError) || importPreview.rows.some((row) => row.errors.length > 0)}>{busy ? 'Importing…' : `Import ${importPreview.rows.length} users`}</button></div>
          </>}
        </section>}

        {canReadUsers && <section className="surface-panel user-directory-panel">
          <div className="section-heading section-heading-panel"><div><h2>User directory</h2><p>{users.length} of the organization’s recent accounts</p></div><UsersRound size={18} /></div>
          {users.length ? <div className="table-wrap"><table><thead><tr><th>User</th><th>Status</th><th>Roles</th><th>Organization scope</th><th>Last sign-in</th><th>Actions</th></tr></thead><tbody>{users.map((row) => <tr key={row.id}>
            <td><strong>{row.firstName} {row.lastName ?? ''}</strong><small className="table-subtext">{row.email}{row.status === 'INVITED' && row.invitationExpiresAt ? ` · link expires ${formatIndianDate(new Date(row.invitationExpiresAt))}` : row.mustChangePassword ? ' · password change required' : ''}</small>
              {canCreateUsers && <details className="platform-user-edit"><summary>Edit profile</summary><form className="platform-form" onSubmit={(event) => void saveUserProfile(event, row.id)}><label>First name<input name="firstName" required maxLength={120} defaultValue={row.firstName} /></label><label>Last name<input name="lastName" maxLength={120} defaultValue={row.lastName ?? ''} /></label><label>Phone<input name="phone" maxLength={32} defaultValue={row.phone ?? ''} /></label><small>Email changes are verified from the user’s own profile.</small><button className="button button-secondary button-small" disabled={busy}>Save profile</button></form></details>}
            </td>
            <td><span className={`status-pill ${row.status === 'ACTIVE' ? 'status-green' : row.status === 'INVITED' ? 'status-amber' : 'status-gray'}`}>{row.status === 'INVITED' ? 'Invitation pending' : enumLabel(row.status)}</span></td>
            <td>{canAssignRoles ? <><select aria-label={`Roles for ${row.email}`} multiple value={userRoleSelections[row.id] ?? []} size={Math.min(Math.max(roles.length, 2), 4)} onChange={(event) => setUserRoleSelections((current) => ({ ...current, [row.id]: [...event.currentTarget.selectedOptions].map((option) => option.value) }))}>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}{role.active ? '' : ' · inactive'}</option>)}</select><button className="button button-secondary button-small" onClick={() => void saveUserRoles(row.id)} disabled={busy}>Save roles</button></> : row.userRoles.map((link) => link.role.name).join(', ')}</td>
            <td><div className="user-scope-summary"><strong>Branches</strong><span>{row.branches.map((branch) => `${branch.name}${branch.isPrimary ? ' · primary' : ''}`).join(', ') || 'None assigned'}</span><strong>Groups</strong><span>{row.organizationUnits.map((unit) => unit.name).join(', ') || 'None assigned'}</span></div>
              {(canManageBranchScope || canManageOrganizationUnitScope) && <details className="platform-user-edit"><summary>Edit access scope</summary>{canManageBranchScope && branches.length > 0 && <div className="user-scope-editor"><label>Branches<select aria-label={`Branch access for ${row.email}`} multiple value={userBranchSelections[row.id] ?? []} onChange={(event) => setUserBranchSelections((current) => ({ ...current, [row.id]: [...event.currentTarget.selectedOptions].map((option) => option.value) }))} size={Math.min(Math.max(branches.length, 2), 4)}>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label><button className="button button-secondary button-small" disabled={busy || row.status !== 'ACTIVE'} onClick={() => void saveUserBranches(row)}>Save branches</button></div>}{canManageOrganizationUnitScope && organizationUnits.length > 0 && <div className="user-scope-editor"><label>Departments or groups<select aria-label={`Group access for ${row.email}`} multiple value={userUnitSelections[row.id] ?? []} onChange={(event) => setUserUnitSelections((current) => ({ ...current, [row.id]: [...event.currentTarget.selectedOptions].map((option) => option.value) }))} size={Math.min(Math.max(organizationUnits.length, 2), 4)}>{organizationUnits.map((unit) => <option value={unit.id} key={unit.id}>{unit.name}</option>)}</select></label><button className="button button-secondary button-small" disabled={busy || row.status !== 'ACTIVE'} onClick={() => void saveUserOrganizationUnits(row)}>Save groups</button></div>}</details>}
            </td>
            <td>{row.lastLoginAt ? formatIndianDateTime(new Date(row.lastLoginAt)) : 'Never'}</td>
            <td className="user-action-cell">{canCreateUsers && (row.status === 'INVITED' || (row.status !== 'ACTIVE' && !row.emailVerifiedAt)) && <button className="button button-secondary button-small" onClick={() => void resendInvitation(row)} disabled={busy}>{row.status === 'INVITED' ? 'Resend invite' : 'Send invite'}</button>}{canCreateUsers && row.status === 'ACTIVE' && row.emailVerifiedAt && <button className="button button-secondary button-small" onClick={() => void sendPasswordReset(row)} disabled={busy}>Send password reset</button>}{canDisableUsers && row.status === 'ACTIVE' && <><button className="button button-secondary button-small" onClick={() => void changeStatus(row, 'SUSPENDED')} disabled={busy}>Suspend</button><button className="button button-secondary button-small" onClick={() => void changeStatus(row, 'DISABLED')} disabled={busy}>Disable</button></>}{canDisableUsers && row.status === 'INVITED' && <button className="button button-secondary button-small" onClick={() => void changeStatus(row, 'DISABLED')} disabled={busy}>Cancel invite</button>}{canDisableUsers && (row.status === 'SUSPENDED' || row.status === 'DISABLED') && row.emailVerifiedAt && <button className="button button-secondary button-small" onClick={() => void changeStatus(row, 'ACTIVE')} disabled={busy}>Activate</button>}</td>
          </tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><UsersRound /></span><h2>No users found</h2><p>Add an individual user or import a CSV to send secure activation links.</p></div>}
        </section>}
      </div>
    </div>}
  </main>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }
