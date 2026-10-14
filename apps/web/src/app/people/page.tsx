'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ApiError, apiRequest } from '../../lib/api';
import { formatIndianDateTime } from '../../lib/locale';
import { useSession } from '../../components/session-provider';
import { useTenant } from '../../components/tenant-provider';
import { organizationCategory } from '@fee/types';
import { Archive, ArrowRight, Download, FileUp, Pencil, Plus, Search, UsersRound, X } from 'lucide-react';

type Person = { id: string; personNumber: string; typeKey: string; typeLabel: string; firstName: string; middleName: string | null; lastName: string | null; preferredName: string | null; email: string | null; phone: string | null; status: string; branchId: string | null; updatedAt: string; account: { id: string; email: string; status: string } | null; branch: { id: string; name: string; code: string } | null };
type Branch = { id: string; code: string; name: string; status: string };
type Page<T> = { items: T[]; pagination: { total: number } };
type Draft = { personNumber: string; typeKey: string; typeLabel: string; firstName: string; middleName: string; lastName: string; preferredName: string; email: string; phone: string; branchId: string };
const emptyDraft: Draft = { personNumber: '', typeKey: 'MEMBER', typeLabel: 'Member', firstName: '', middleName: '', lastName: '', preferredName: '', email: '', phone: '', branchId: '' };

export default function PeoplePage() {
  const { user } = useSession();
  const tenant = useTenant();
  const category = organizationCategory(tenant.kind === 'tenant' ? tenant.organizationCategory : null);
  const peopleLabel = category.peopleLabel;
  const personLabel = category.personLabel;
  const personTypeKey = personLabel.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const canRead = Boolean(user?.isPlatformAdmin || user?.permissions.includes('user.read'));
  const canCreate = Boolean(user?.isPlatformAdmin || user?.permissions.includes('user.create'));
  const canUpdate = Boolean(user?.isPlatformAdmin || user?.permissions.includes('user.update'));
  const [people, setPeople] = useState<Person[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvName, setCsvName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!canRead) return;
    try {
      const query = new URLSearchParams({ pageSize: '200', status: 'ACTIVE,INACTIVE,SUSPENDED' });
      if (search.trim()) query.set('search', search.trim());
      if (typeFilter) query.set('typeKey', typeFilter);
      const [result, branchPage] = await Promise.all([
        apiRequest<Page<Person>>(`/people?${query.toString()}`),
        apiRequest<Page<Branch>>('/branches?pageSize=200&status=ACTIVE'),
      ]);
      setPeople(result.items); setBranches(branchPage.items.filter((branch) => branch.status === 'ACTIVE')); setError('');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'People records could not be loaded.'); }
  }, [canRead, search, typeFilter]);

  useEffect(() => { void load(); }, [load]);
  const types = useMemo(() => [...new Set(people.map((person) => person.typeKey))].sort(), [people]);
  const csvPreview = useMemo(() => parsePeopleCsv(csvText, branches, personTypeKey, personLabel), [csvText, branches, personTypeKey, personLabel]);

  function startCreate() { setEditing(null); setDraft({ ...emptyDraft, typeKey: personTypeKey, typeLabel: personLabel }); setShowForm(true); setError(''); }
  function startEdit(person: Person) {
    setEditing(person.id);
    setDraft({ personNumber: person.personNumber, typeKey: person.typeKey, typeLabel: person.typeLabel, firstName: person.firstName, middleName: person.middleName ?? '', lastName: person.lastName ?? '', preferredName: person.preferredName ?? '', email: person.email ?? '', phone: person.phone ?? '', branchId: person.branchId ?? '' });
    setShowForm(true); setError('');
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    const input = { ...draft, personNumber: draft.personNumber.trim() || undefined, middleName: draft.middleName.trim() || null, lastName: draft.lastName.trim() || null, preferredName: draft.preferredName.trim() || null, email: draft.email.trim() || null, phone: draft.phone.trim() || null, branchId: draft.branchId || null };
    try {
      if (editing) await apiRequest(`/people/${editing}`, { method: 'PATCH', body: JSON.stringify(input) });
      else await apiRequest('/people', { method: 'POST', body: JSON.stringify(input) });
      setNotice(editing ? 'Person profile updated.' : 'Person added to this workspace.'); setShowForm(false); setDraft(emptyDraft); setEditing(null); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The person profile could not be saved.'); }
    finally { setBusy(false); }
  }

  async function archive(person: Person) {
    if (!window.confirm(`Archive ${person.firstName} ${person.lastName ?? ''}? Their fee and attendance history will be retained.`)) return;
    setBusy(true); setError(''); setNotice('');
    try { await apiRequest(`/people/${person.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'ARCHIVED' }) }); setNotice('Person archived. Financial and attendance history is retained.'); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The person could not be archived.'); }
    finally { setBusy(false); }
  }

  async function importCsv() {
    if (!csvPreview.rows.length || csvPreview.errors.length) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await apiRequest<{ count: number }>('/people/bulk', { method: 'POST', body: JSON.stringify({ people: csvPreview.rows }) });
      setNotice(`${result.count} people imported. You can invite a person portal account from Users and roles.`); setCsvText(''); setCsvName(''); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'The import failed; no people were added.'); }
    finally { setBusy(false); }
  }

  function downloadTemplate() {
    const contents = 'personNumber,typeKey,typeLabel,firstName,middleName,lastName,email,phone,branchCode\n';
    const url = URL.createObjectURL(new Blob([contents], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'wasl-people-import-template.csv'; link.click(); URL.revokeObjectURL(url);
  }

  if (!canRead) return <main id="main-content" className="page-content"><div className="page-heading"><div><p className="eyebrow">ORGANISATION</p><h1>{peopleLabel}</h1></div></div><div className="notice notice-error" role="alert">Your role does not have permission to view the {peopleLabel.toLowerCase()} directory.</div></main>;

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">{peopleLabel.toUpperCase()} DIRECTORY</p><h1>{peopleLabel}</h1><p className="muted">Manage {peopleLabel.toLowerCase()}, teams, and other configured person types in this workspace.</p></div><div className="heading-actions"><span className="heading-count"><UsersRound size={16} /> {people.length} records</span>{canCreate && <button className="button button-primary" onClick={startCreate}><Plus size={16} /> Add {personLabel.toLowerCase()}</button>}</div></div>
    {notice && <div className="notice notice-success" role="status">{notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    <section className="surface-panel"><div className="people-directory-filters"><label className="search-field"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, ID, email, or phone" /></label><label>Person type<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="">All types</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}</select></label></div>
      {people.length ? <div className="table-wrap"><table><thead><tr><th>Person</th><th>Type</th><th>Branch</th><th>Contact</th><th>Portal access</th><th>Updated</th><th></th></tr></thead><tbody>{people.map((person) => <tr key={person.id}><td><strong>{[person.preferredName || person.firstName, person.middleName, person.lastName].filter(Boolean).join(' ')}</strong><small className="table-subtext">{person.personNumber}</small></td><td>{person.typeLabel}<small className="table-subtext">{person.typeKey}</small></td><td>{person.branch?.name ?? 'Unassigned'}</td><td>{person.email ?? 'No email'}{person.phone && <small className="table-subtext">{person.phone}</small>}</td><td>{person.account ? <span className="status-pill status-green">{person.account.status}</span> : <Link className="text-button" href="/access">Invite account</Link>}</td><td>{formatIndianDateTime(new Date(person.updatedAt))}</td><td><div className="table-row-actions">{canUpdate && <button className="icon-button" aria-label={`Edit ${person.firstName}`} onClick={() => startEdit(person)}><Pencil size={15} /></button>}{canUpdate && <button className="icon-button" aria-label={`Archive ${person.firstName}`} onClick={() => void archive(person)} disabled={busy || Boolean(person.account)} title={person.account ? 'Suspend the linked user account before archiving this profile.' : 'Archive person'}><Archive size={15} /></button>}</div></td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><UsersRound /></span><h2>No people found</h2><p>Create a profile or import a CSV. A person profile can receive fees, attend sessions, and get a secure portal account without creating an industry-specific tenant system.</p>{canCreate && <button className="button button-primary" onClick={startCreate}><Plus size={15} /> Add first person</button>}</div>}
    </section>
    {canCreate && <section className="surface-panel people-import-panel"><div className="section-heading section-heading-panel"><div><h2>Bulk import people</h2><p>Review each row before adding profiles to the selected workspace.</p></div><FileUp size={18} /></div><div className="user-import-actions"><button type="button" className="button button-secondary button-small" onClick={downloadTemplate}><Download size={14} /> Download CSV template</button><label className="button button-secondary button-small import-file-button"><FileUp size={14} /> Choose CSV<input type="file" accept=".csv,text/csv" onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (file.size > 2 * 1024 * 1024 || !file.name.toLowerCase().endsWith('.csv')) { setError('Choose a CSV file smaller than 2 MB.'); return; } setCsvName(file.name); setCsvText(await file.text()); setError(''); }} /></label></div>
      <p className="muted">Columns: personNumber, typeKey, typeLabel, firstName, middleName, lastName, email, phone, branchCode.</p>
      {csvName && <p className="user-import-filename">Reviewing <strong>{csvName}</strong> · {csvPreview.rows.length} rows</p>}{csvPreview.errors.length > 0 && <div className="notice notice-error" role="alert">{csvPreview.errors.slice(0, 8).join(' · ')}{csvPreview.errors.length > 8 ? ` · and ${csvPreview.errors.length - 8} more` : ''}</div>}
      {csvName && <div className="access-save-row"><span className="muted">{csvPreview.rows.length} profiles ready to add</span><button className="button button-primary" disabled={busy || !csvPreview.rows.length || Boolean(csvPreview.errors.length)} onClick={() => void importCsv()}>{busy ? 'Importing…' : 'Import people'}</button></div>}
    </section>}
    {showForm && <div className="people-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForm(false); }}><section className="surface-panel people-editor" role="dialog" aria-modal="true" aria-labelledby="people-editor-title"><div className="section-heading section-heading-panel"><div><p className="eyebrow">{personLabel.toUpperCase()} PROFILE</p><h2 id="people-editor-title">{editing ? `Edit ${personLabel.toLowerCase()}` : `Add ${personLabel.toLowerCase()}`}</h2><p className="muted">Use the terminology that fits this organisation. The core record remains generic.</p></div><button className="icon-button" aria-label="Close editor" onClick={() => setShowForm(false)}><X size={16} /></button></div><form className="people-editor-form" onSubmit={(event) => void save(event)}>
      <label>Person ID <span className="muted">(optional)</span><input value={draft.personNumber} onChange={(event) => setDraft({ ...draft, personNumber: event.target.value })} maxLength={80} placeholder="Auto-generated if blank" /></label>
      <label>Type key<input required value={draft.typeKey} onChange={(event) => setDraft({ ...draft, typeKey: event.target.value.toUpperCase() })} maxLength={80} pattern="[A-Za-z][A-Za-z0-9_-]*" placeholder="MEMBER, EMPLOYEE, STUDENT" /></label>
      <label>Type label<input required value={draft.typeLabel} onChange={(event) => setDraft({ ...draft, typeLabel: event.target.value })} maxLength={100} placeholder="Member, Employee, Student" /></label>
      <label>First name<input required value={draft.firstName} onChange={(event) => setDraft({ ...draft, firstName: event.target.value })} maxLength={120} /></label>
      <label>Middle name<input value={draft.middleName} onChange={(event) => setDraft({ ...draft, middleName: event.target.value })} maxLength={120} /></label>
      <label>Last name<input value={draft.lastName} onChange={(event) => setDraft({ ...draft, lastName: event.target.value })} maxLength={120} /></label>
      <label>Preferred name<input value={draft.preferredName} onChange={(event) => setDraft({ ...draft, preferredName: event.target.value })} maxLength={120} /></label>
      <label>Email<input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} maxLength={254} /></label>
      <label>Phone<input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} maxLength={40} /></label>
      <label>Home branch<select value={draft.branchId} onChange={(event) => setDraft({ ...draft, branchId: event.target.value })}><option value="">Unassigned</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} · {branch.code}</option>)}</select></label>
      <div className="people-editor-actions"><button type="button" className="button button-secondary" onClick={() => setShowForm(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add person'} <ArrowRight size={15} /></button></div>
    </form></section></div>}
  </main>;
}

function parsePeopleCsv(text: string, branches: Branch[], defaultTypeKey: string, defaultTypeLabel: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return { rows: [] as Array<Record<string, unknown>>, errors: [] as string[] };
  const headers = parseCsvLine(lines[0]!).map((header) => header.trim().toLowerCase());
  const required = ['firstName'];
  const errors: string[] = [];
  for (const field of required) if (!headers.includes(field.toLowerCase())) errors.push(`Missing required ${field} column.`);
  const branchByCode = new Map(branches.map((branch) => [branch.code.toLowerCase(), branch.id]));
  const rows: Array<Record<string, unknown>> = [];
  for (let index = 1; index < lines.length; index += 1) {
    const cells = parseCsvLine(lines[index]!);
    const values = Object.fromEntries(headers.map((header, column) => [header, cells[column]?.trim() ?? '']));
    if (!values.firstname) { errors.push(`Row ${index + 1}: firstName is required.`); continue; }
    const branchCode = values.branchcode?.toLowerCase();
    if (branchCode && !branchByCode.has(branchCode)) { errors.push(`Row ${index + 1}: branchCode “${values.branchcode}” is not an active branch.`); continue; }
    const email = values.email || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errors.push(`Row ${index + 1}: email is invalid.`); continue; }
    rows.push({ personNumber: values.personnumber || undefined, typeKey: values.typekey || defaultTypeKey, typeLabel: values.typelabel || defaultTypeLabel, firstName: values.firstname, middleName: values.middlename || null, lastName: values.lastname || null, email, phone: values.phone || null, branchId: branchCode ? branchByCode.get(branchCode) : null });
  }
  if (lines.length - 1 > 100) errors.push('Bulk import accepts at most 100 people per file.');
  return { rows, errors };
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []; let cell = ''; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"' && quoted && line[index + 1] === '"') { cell += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { cells.push(cell); cell = ''; }
    else cell += character;
  }
  cells.push(cell); return cells;
}
