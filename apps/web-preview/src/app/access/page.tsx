'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { enumLabel } from '@fee/types';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { useSession } from '../../components/session-provider';
import { Check, KeyRound, ShieldCheck, UserPlus, UsersRound } from 'lucide-react';

interface Role { id: string; key: string; name: string; description: string | null; isSystem: boolean; permissionsConfigured: boolean; permissionKeys: string[] }
interface Permission { id: string; key: string; resource: string; action: string; description: string | null; sensitive: boolean }
interface PermissionGroup { group: string; permissions: string[] }
interface UserRow {
  id: string; email: string; phone: string | null; firstName: string; lastName: string | null; status: string; mustChangePassword: boolean; studentId: string | null; guardianId: string | null;
  lastLoginAt: string | null; createdAt: string; userRoles: Array<{ role: { id: string; key: string; name: string } }>;
}
interface PortalSubjects { students: Array<{ id: string; admissionNumber: string; firstName: string; middleName: string | null; lastName: string | null }>; guardians: Array<{ id: string; firstName: string; lastName: string | null; email: string | null; phone: string | null }> }
interface PageResult<T> { items: T[]; pagination: { total: number } }

export default function AccessPage() {
  const { user } = useSession();
  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [permissionGroups, setPermissionGroups] = useState<PermissionGroup[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [portalSubjects, setPortalSubjects] = useState<PortalSubjects>({ students: [], guardians: [] });
  const [createRoleIds, setCreateRoleIds] = useState<string[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [selectedPermissionKeys, setSelectedPermissionKeys] = useState<string[]>([]);
  const [userRoleSelections, setUserRoleSelections] = useState<Record<string, string[]>>({});
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canReadUsers = hasPermission(user, 'user.read');
  const canCreateUsers = hasPermission(user, 'user.create') && hasPermission(user, 'role.assign');
  const canDisableUsers = hasPermission(user, 'user.disable');
  const canAssignRoles = hasPermission(user, 'role.assign');
  const canReadRoles = hasPermission(user, 'role.read');
  const canReadPermissions = hasPermission(user, 'permission.read');

  const load = useCallback(async () => {
    setError('');
    try {
      const [userPage, roleRows, catalog, subjects] = await Promise.all([
        canReadUsers ? apiRequest<PageResult<UserRow>>('/access/users?pageSize=200') : Promise.resolve({ items: [], pagination: { total: 0 } }),
        canReadRoles ? apiRequest<Role[]>('/access/roles') : Promise.resolve([]),
        canReadPermissions ? apiRequest<{ groups: PermissionGroup[]; permissions: Permission[] }>('/access/permissions') : Promise.resolve({ groups: [], permissions: [] }),
        canCreateUsers ? apiRequest<PortalSubjects>('/access/portal-subjects') : Promise.resolve({ students: [], guardians: [] } as PortalSubjects),
      ]);
      setUsers(userPage.items); setRoles(roleRows); setPermissionGroups(catalog.groups); setPermissions(catalog.permissions); setPortalSubjects(subjects);
      setUserRoleSelections(Object.fromEntries(userPage.items.map((row) => [row.id, row.userRoles.map((link) => link.role.id)])));
      setSelectedRoleId((current) => roleRows.some((role) => role.id === current) ? current : roleRows[0]?.id ?? '');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'User and role records could not be loaded.'); }
  }, [canReadUsers, canReadRoles, canReadPermissions, canCreateUsers]);
  useEffect(() => { void load(); }, [load]);

  const selectedRole = roles.find((role) => role.id === selectedRoleId);
  const selectedCreateRoleKeys = roles.filter((role) => createRoleIds.includes(role.id)).map((role) => role.key);
  useEffect(() => { setSelectedPermissionKeys(selectedRole?.permissionKeys ?? []); }, [selectedRoleId, selectedRole?.permissionKeys.join('|')]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const result = await apiRequest<{ firstName: string; email: string }>('/access/users', { method: 'POST', body: JSON.stringify({
        firstName: form.get('firstName'), lastName: form.get('lastName') || null, email: form.get('email'), phone: form.get('phone') || null,
        temporaryPassword: form.get('temporaryPassword'), roleIds: form.getAll('roleIds'),
        studentId: form.get('studentId') || null, guardianId: form.get('guardianId') || null,
      }) });
      setNotice(`Account created for ${result.firstName} (${result.email}). Share its temporary password securely; the first sign-in requires a password change.`);
      formElement.reset(); setCreateRoleIds([]); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The user account could not be created.'); }
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

  async function changeStatus(row: UserRow) {
    const status = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'; setBusy(true); setError(''); setNotice('');
    try {
      await apiRequest(`/access/users/${row.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setNotice(`${row.email} is now ${status.toLowerCase()}.`); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The account status could not be changed.'); }
    finally { setBusy(false); }
  }

  if (!canReadUsers && !canReadRoles && !canReadPermissions) return <main id="main-content" className="page-content"><div className="page-heading"><div><p className="eyebrow">SECURITY</p><h1>Users and roles</h1></div></div><div className="notice notice-error" role="alert">Your role does not have access to user or role administration.</div></main>;

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">SECURITY</p><h1>Users and roles</h1><p className="muted">Manage tenant accounts, role membership, and permission grants.</p></div><span className="heading-count"><ShieldCheck size={16} /> Institution scoped</span></div>
    {notice && <div className="notice notice-success" role="status"><Check size={16} /> {notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    <div className="access-layout">
      {canReadRoles && canReadPermissions && <section className="surface-panel role-editor-panel"><div className="section-heading section-heading-panel"><div><h2>Role permissions</h2><p>Untouched system roles use the default permission matrix. Saving makes the displayed grants explicit.</p></div></div>
        {roles.length ? <><label className="access-picker">Role<select value={selectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value)}>{roles.map((role) => <option value={role.id} key={role.id}>{role.name}{role.isSystem ? ' · system' : ''}</option>)}</select></label>
          {selectedRole && <div className="permission-groups">{permissionGroups.map((group) => <fieldset key={group.group} className="permission-group"><legend>{group.group}</legend>{group.permissions.map((key) => {
            const permission = permissions.find((entry) => entry.key === key);
            const checked = selectedPermissionKeys.includes(key);
            return <label key={key} className="permission-check"><input type="checkbox" checked={checked} disabled={!canAssignRoles} onChange={(event) => setSelectedPermissionKeys((current) => event.target.checked ? [...current, key] : current.filter((entry) => entry !== key))} /><span><strong>{enumLabel(key)}</strong><small>{permission?.description ?? key}{permission?.sensitive ? ' · approval-sensitive' : ''}</small></span></label>;
          })}</fieldset>)}</div>}
          {canAssignRoles && <div className="access-save-row"><span className="muted">{selectedPermissionKeys.length} permission grants</span><button className="button button-primary" onClick={() => void saveRolePermissions()} disabled={busy}>Save role</button></div>}
        </> : <div className="empty-state"><span className="empty-icon"><ShieldCheck /></span><h2>No tenant roles</h2><p>Default roles are created when the institution is provisioned.</p></div>}
      </section>}

      <div className="access-right-column">
        {canCreateUsers && canReadRoles && <section className="surface-panel user-create-panel"><div className="section-heading section-heading-panel"><div><h2>Create a user</h2><p>New accounts are active and must replace the temporary password on first sign-in.</p></div><UserPlus size={18} /></div>
          <form className="access-user-form" onSubmit={createUser}>
            <label>First name<input name="firstName" required maxLength={120} /></label><label>Last name<input name="lastName" maxLength={120} /></label>
            <label>Email<input name="email" type="email" required maxLength={254} /></label><label>Phone<input name="phone" maxLength={32} /></label>
            <label className="wide-field">Temporary password<input name="temporaryPassword" type="password" minLength={12} required autoComplete="new-password" /><small>At least 12 characters. Share it with the user through a secure channel.</small></label>
            <label className="wide-field">Roles<select name="roleIds" multiple required value={createRoleIds} onChange={(event) => setCreateRoleIds([...event.currentTarget.selectedOptions].map((option) => option.value))} size={Math.min(Math.max(roles.length, 2), 6)}>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select><small>Portal roles are provisioned as separate accounts and cannot be mixed with staff roles.</small></label>
            {selectedCreateRoleKeys.includes('STUDENT') && <label className="wide-field">Linked student<select name="studentId" required defaultValue=""><option value="">Choose student</option>{portalSubjects.students.map((student) => <option key={student.id} value={student.id}>{student.admissionNumber} · {[student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ')}</option>)}</select></label>}
            {selectedCreateRoleKeys.includes('PARENT') && <label className="wide-field">Linked guardian<select name="guardianId" required defaultValue=""><option value="">Choose guardian</option>{portalSubjects.guardians.map((guardian) => <option key={guardian.id} value={guardian.id}>{[guardian.firstName, guardian.lastName].filter(Boolean).join(' ')} · {guardian.email ?? guardian.phone ?? 'No contact'}</option>)}</select><small>A guardian must already be linked to at least one student.</small></label>}
            <button className="button button-primary wide-field" disabled={busy}><UserPlus size={15} /> {busy ? 'Creating…' : 'Create account'}</button>
          </form>
        </section>}

        {canReadUsers && <section className="surface-panel user-directory-panel"><div className="section-heading section-heading-panel"><div><h2>User directory</h2><p>{users.length} of the institution’s recent accounts</p></div><UsersRound size={18} /></div>{users.length ? <div className="table-wrap"><table><thead><tr><th>User</th><th>Status</th><th>Roles</th><th>Last sign-in</th><th>Access</th></tr></thead><tbody>{users.map((row) => <tr key={row.id}><td><strong>{row.firstName} {row.lastName ?? ''}</strong><small className="table-subtext">{row.email}{row.mustChangePassword ? ' · temporary password' : ''}</small></td><td><span className={`status-pill ${row.status === 'ACTIVE' ? 'status-green' : 'status-amber'}`}>{enumLabel(row.status)}</span></td><td>{canAssignRoles ? <><select multiple value={userRoleSelections[row.id] ?? []} size={Math.min(Math.max(roles.length, 2), 4)} onChange={(event) => setUserRoleSelections((current) => ({ ...current, [row.id]: [...event.currentTarget.selectedOptions].map((option) => option.value) }))}>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select><button className="button button-secondary button-small" onClick={() => void saveUserRoles(row.id)} disabled={busy}>Save roles</button></> : row.userRoles.map((link) => link.role.name).join(', ')}</td><td>{row.lastLoginAt ? new Date(row.lastLoginAt).toLocaleString() : 'Never'}</td><td>{canDisableUsers && <button className="button button-secondary button-small" onClick={() => void changeStatus(row)} disabled={busy}>{row.status === 'ACTIVE' ? 'Disable' : 'Activate'}</button>}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><UsersRound /></span><h2>No users found</h2><p>Create an account for a staff member who needs institution access.</p></div>}</section>}
      </div>
    </div>
  </main>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }
