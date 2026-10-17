'use client';
import { formatIndianCurrency, formatIndianDate } from '../../lib/locale';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CircleCheck, Clock3 } from 'lucide-react';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { useSession } from '../../components/session-provider';

interface Student { id: string; admissionNumber: string; firstName: string; middleName: string | null; lastName: string | null }
interface ScheduleItem { id: string; amount: string; adjustmentAmount: string; paidAmount: string; remainingAmount: string; demandItem: { feeTypeCode: string; feeTypeName: string } | null }
interface Installment { id: string; label: string; sequence: number; dueDate: string; amount: string; adjustmentAmount: string; paidAmount: string; waivedAmount: string; remainingAmount: string; displayStatus: string; demand: { demandNumber: string; currency: string; dueDate: string }; items: ScheduleItem[] }
interface Schedule { student: Student; installments: Installment[] }

export default function InstallmentsPage() {
  const { user } = useSession();
  const [students, setStudents] = useState<Student[]>([]);
  const [studentId, setStudentId] = useState('');
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const canRead = hasPermission(user, 'fee.demand.read');

  const loadStudents = useCallback(async () => {
    try { const page = await apiRequest<{ items: Student[] }>('/students?pageSize=500&sort=admissionNumber'); setStudents(page.items); setError(''); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Student schedules could not be loaded.'); }
  }, []);
  useEffect(() => { void loadStudents(); }, [loadStudents]);
  useEffect(() => {
    if (!studentId || !canRead) { setSchedule(null); return; }
    setLoading(true); setError('');
    void apiRequest<Schedule>(`/installments/students/${studentId}`).then(setSchedule).catch((cause) => setError(cause instanceof ApiError ? cause.message : 'Installment schedule could not be loaded.')).finally(() => setLoading(false));
  }, [studentId, canRead]);

  const currency = schedule?.installments[0]?.demand.currency ?? 'INR';
  const dueTotal = (schedule?.installments ?? []).reduce((sum, item) => sum + Number(item.remainingAmount), 0);
  const settledTotal = (schedule?.installments ?? []).reduce((sum, item) => sum + Number(item.paidAmount), 0);
  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">FEE MANAGEMENT</p><h1>Installments</h1><p className="muted">Review each student's saved fee schedule, due dates, and actual settlement balance.</p></div><span className="heading-count"><CalendarClock size={16} /> {schedule?.installments.length ?? 0} schedule rows</span></div>
    {error && <div className="notice notice-error" role="alert">{error}</div>}{!canRead && <div className="notice notice-error" role="alert">Your role needs fee demand read access to view schedules.</div>}
    <section className="surface-panel installment-page-panel">
      <div className="installment-toolbar"><label>Student<select value={studentId} onChange={(event) => setStudentId(event.target.value)}><option value="">Choose a student</option>{students.map((student) => <option key={student.id} value={student.id}>{student.admissionNumber} · {[student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ')}</option>)}</select></label><div className="installment-metrics"><span><small>Settled</small><strong>{formatIndianCurrency(settledTotal.toFixed(2), currency)}</strong></span><span><small>Remaining</small><strong>{formatIndianCurrency(dueTotal.toFixed(2), currency)}</strong></span></div></div>
      {loading ? <div className="loading-page" role="status">Loading installment schedule…</div> : schedule?.installments.length ? <div className="table-wrap"><table><thead><tr><th>Installment</th><th>Demand</th><th>Due date</th><th>Scheduled</th><th>Settled</th><th>Remaining</th><th>Status</th></tr></thead><tbody>{schedule.installments.map((item) => <tr key={item.id}><td><strong>{item.sequence}. {item.label}</strong><small className="table-subtext">{item.items.map((part) => part.demandItem?.feeTypeName).filter(Boolean).join(', ')}</small></td><td className="mono-cell">{item.demand.demandNumber}</td><td>{formatIndianDate(new Date(item.dueDate))}</td><td>{formatIndianCurrency(item.amount, item.demand.currency)}<small className="table-subtext">Adjustment {formatIndianCurrency(item.adjustmentAmount, item.demand.currency)}</small></td><td>{formatIndianCurrency(item.paidAmount, item.demand.currency)}</td><td><strong>{formatIndianCurrency(item.remainingAmount, item.demand.currency)}</strong></td><td><span className={`status-pill ${item.displayStatus === 'PAID' ? 'status-green' : item.displayStatus === 'OVERDUE' ? 'status-red' : 'status-gray'}`}>{item.displayStatus === 'PAID' ? <CircleCheck size={12} /> : <Clock3 size={12} />} {item.displayStatus.replaceAll('_', ' ')}</span></td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><CalendarClock /></span><h2>{studentId ? 'No installment schedule' : 'Choose a student'}</h2><p>{studentId ? 'This student has no generated installment schedules.' : 'Select a student to view generated installment schedules and settlement status.'}</p></div>}
    </section>
  </main>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }
