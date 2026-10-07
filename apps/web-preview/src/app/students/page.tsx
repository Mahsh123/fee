'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plus, Search, UsersRound } from 'lucide-react';
import { ApiError, apiRequest } from '../../lib/api';

interface Student { id: string; admissionNumber: string; firstName: string; lastName: string | null; primaryUnitId: string | null; status: string; email: string | null; phone: string | null }
interface Paginated<T> { items: T[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }

export default function StudentsPage() {
  const [result, setResult] = useState<Paginated<Student> | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setError(''); setResult(await apiRequest<Paginated<Student>>(`/students?page=1&pageSize=25${query ? `&search=${encodeURIComponent(query)}` : ''}`)); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Student records could not be loaded.'); }
  }, [query]);
  useEffect(() => { void load(); }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; setBusy(true); setError(''); setNotice('');
    const values = new FormData(form);
    try {
      await apiRequest<Student>('/students', { method: 'POST', body: JSON.stringify({ firstName: String(values.get('firstName')).trim(), lastName: String(values.get('lastName')).trim() || null, email: String(values.get('email')).trim() || null, phone: String(values.get('phone')).trim() || null }) });
      form.reset(); setNotice('Student added. Their admission number was assigned by the institution.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Student could not be created.'); }
    finally { setBusy(false); }
  }

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">PEOPLE</p><h1>Students</h1><p className="muted">Student records for this institution.</p></div><span className="heading-count"><UsersRound size={16} /> {result?.pagination.total.toLocaleString() ?? '—'} records</span></div>
    <section className="surface-panel"><div className="panel-toolbar"><div className="search-box"><Search size={17} /><input aria-label="Search students" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') setQuery(search.trim()); }} placeholder="Search name, admission number, email" /></div><button className="button button-secondary" onClick={() => setQuery(search.trim())}>Search</button><details className="create-menu"><summary className="button button-primary"><Plus size={16} /> Add student</summary><form className="popover-form" onSubmit={create}><strong>New student</strong><label>First name<input name="firstName" required maxLength={120} /></label><label>Last name<input name="lastName" maxLength={120} /></label><label>Email<input name="email" type="email" /></label><label>Phone<input name="phone" type="tel" /></label><button className="button button-primary button-wide" disabled={busy}>{busy ? 'Adding…' : 'Add student'}</button></form></details></div>
      {notice && <div className="notice notice-success" role="status">{notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
      {result?.items.length ? <div className="table-wrap"><table><thead><tr><th>Student</th><th>Admission number</th><th>Contact</th><th>Status</th><th></th></tr></thead><tbody>{result.items.map((student) => <tr key={student.id}><td><div className="person-cell"><span className="avatar avatar-table">{student.firstName[0]?.toUpperCase()}</span><span><strong>{student.firstName} {student.lastName ?? ''}</strong><small>{student.email ?? 'No email added'}</small></span></div></td><td className="mono-cell">{student.admissionNumber}</td><td>{student.phone ?? '—'}</td><td><span className={`status-pill ${student.status === 'ACTIVE' ? 'status-green' : 'status-gray'}`}>{student.status.replaceAll('_', ' ')}</span></td><td><Link className="text-link" href={`/students/${student.id}`}>View</Link></td></tr>)}</tbody></table></div> : result ? <div className="empty-state"><span className="empty-icon"><UsersRound /></span><h2>No students found</h2><p>Add a student record or try a different search.</p></div> : <div className="loading-table">Loading students…</div>}
      {result && <div className="table-footer"><span>Showing {result.items.length} of {result.pagination.total} students</span><span>Page {result.pagination.page} of {Math.max(result.pagination.totalPages, 1)}</span></div>}
    </section>
  </main>;
}
