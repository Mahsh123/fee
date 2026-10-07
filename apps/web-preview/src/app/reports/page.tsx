'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { useSession } from '../../components/session-provider';
import { BarChart3, Download } from 'lucide-react';

interface FinanceReport {
  tenantId: string;
  period: { from: string; to: string; timezone: string };
  dailyCollections: Array<{ day: string; currency: string; count: number; grossAmount?: string; amount?: string }>;
  collectionByMethod: Array<{ method: string; channel: string; currency: string; count: number; grossAmount?: string; amount?: string }>;
  collectionByPayer: Array<{ payerType: string; payerName: string; currency: string; count: number; grossAmount?: string; amount?: string }>;
  collectionSummary?: Array<{ currency: string; paymentCount: number; refundCount: number; grossCollected: string; refunds: string; netAfterRefunds: string }>;
  refunds: Array<{ currency: string; count: number; amount: string }>;
  outstanding: Array<{ currency: string; openCount: number; overdueCount: number; outstanding: string }>;
  feeAdjustments: Array<{ currency: string; scholarship: string; discount: string; concession: string; waiver: string; override: string; surcharge: string; lateFee: string; tax: string }>;
  operationalAdjustments: Array<{ currency: string; kind: string; direction: string; count: number; amount: string }>;
}

export default function ReportsPage() {
  const { user } = useSession();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<FinanceReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const canRead = hasPermission(user, 'report.read');

  const load = useCallback(async () => {
    if (!canRead || !from || !to) return;
    setLoading(true); setError('');
    try { setReport(await apiRequest<FinanceReport>(`/reports/finance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Finance reports could not be loaded.'); }
    finally { setLoading(false); }
  }, [canRead, from, to]);
  useEffect(() => { void load(); }, [load]);

  function downloadCsv() {
    if (!report) return;
    const rows: Array<Array<string | number>> = [['tenant_id', report.tenantId], ['period_from', report.period.from], ['period_to', report.period.to], ['timezone', report.period.timezone], [], ['report', 'date_or_method', 'currency', 'count', 'amount']];
    for (const row of report.collectionSummary ?? []) rows.push(['collection_summary', '', row.currency, `${row.paymentCount} payments / ${row.refundCount} refunds`, `gross ${row.grossCollected}; refunds ${row.refunds}; net after refunds ${row.netAfterRefunds}`]);
    for (const row of report.dailyCollections) rows.push(['daily_gross_collection', row.day, row.currency, row.count, row.grossAmount ?? row.amount ?? '0']);
    for (const row of report.collectionByMethod) rows.push(['gross_collection_by_method', `${row.channel}:${row.method}`, row.currency, row.count, row.grossAmount ?? row.amount ?? '0']);
    for (const row of report.collectionByPayer) rows.push(['gross_collection_by_payer', `${row.payerType}:${row.payerName}`, row.currency, row.count, row.grossAmount ?? row.amount ?? '0']);
    for (const row of report.refunds) rows.push(['refunds', '', row.currency, row.count, row.amount]);
    for (const row of report.outstanding) rows.push(['outstanding', '', row.currency, `${row.openCount} open / ${row.overdueCount} overdue`, row.outstanding]);
    for (const row of report.feeAdjustments) rows.push(['fee_adjustments', '', row.currency, '', `scholarship ${row.scholarship}; discount ${row.discount}; concession ${row.concession}; waiver ${row.waiver}; override ${row.override}; surcharge ${row.surcharge}; late fee ${row.lateFee}; tax ${row.tax}`]);
    for (const row of report.operationalAdjustments) rows.push(['operational_adjustment', row.kind, row.currency, `${row.count} ${row.direction.toLowerCase()}`, row.amount]);
    const csv = rows.map((row) => row.map((value) => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `finance-report-${from}-${to}.csv`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (!canRead) return <main id="main-content" className="page-content"><div className="page-heading"><div><p className="eyebrow">FINANCE</p><h1>Reports</h1></div></div><div className="notice notice-error" role="alert">Your role needs report read access to view finance reports.</div></main>;

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">FINANCE</p><h1>Reports</h1><p className="muted">Gross collections, completed refunds, period net, issued demand snapshots, and current open balances.</p></div>{report && <button className="button button-secondary" onClick={downloadCsv}><Download size={15} /> Export CSV</button>}</div>
    <section className="surface-panel report-filter-panel"><label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label><label>To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label><span className="muted">Report dates use {report?.period.timezone ?? 'tenant'} local time.</span></section>
    {error && <div className="notice notice-error" role="alert">{error}</div>}{loading && <div className="loading-page" role="status">Preparing tenant financial totals…</div>}
    {report && <>
      <div className="report-context"><BarChart3 size={15} /><span>Tenant {report.tenantId}</span><span>{report.period.from} – {report.period.to}</span><span>{report.period.timezone}</span></div>
      <div className="report-grid">
        <ReportTable title="Gross collections and net after refunds" description="Gross uses payment dates; refunds use completion dates. Net after refunds is the period gross less completed refunds, before gateway fees." headers={['Currency', 'Payments', 'Refunds', 'Gross collected', 'Refunded', 'Net after refunds']} rows={(report.collectionSummary ?? []).map((row) => [row.currency, row.paymentCount, row.refundCount, row.grossCollected, row.refunds, row.netAfterRefunds])} empty="No captured payments or completed refunds in this date range." />
        <ReportTable title="Daily gross collection" description="Captured payments grouped by tenant-local payment date. Amounts remain gross after partial or full refunds." headers={['Date', 'Currency', 'Payments', 'Gross collected']} rows={report.dailyCollections.map((row) => [row.day, row.currency, row.count, row.grossAmount ?? row.amount ?? '0'])} empty="No captured payments in this date range." />
        <ReportTable title="Gross collection by method" description="Captured payments grouped by recorded method, before completed refunds." headers={['Channel', 'Method', 'Currency', 'Payments', 'Gross collected']} rows={report.collectionByMethod.map((row) => [row.channel.replaceAll('_', ' '), row.method.replaceAll('_', ' '), row.currency, row.count, row.grossAmount ?? row.amount ?? '0'])} empty="No payment method totals in this date range." />
        <ReportTable title="Gross collections by payer" description="Captured third-party contributions, before completed refunds. Payer contributions remain separate from fee discounts and waivers." headers={['Payer type', 'Payer', 'Currency', 'Payments', 'Gross collected']} rows={report.collectionByPayer.map((row) => [row.payerType.replaceAll('_', ' '), row.payerName, row.currency, row.count, row.grossAmount ?? row.amount ?? '0'])} empty="No payer contributions in this date range." />
        <ReportTable title="Outstanding and overdue" description="Current balances on issued fee demands." headers={['Currency', 'Open demands', 'Overdue', 'Outstanding']} rows={report.outstanding.map((row) => [row.currency, row.openCount, row.overdueCount, row.outstanding])} empty="No open fee demand balances." />
        <ReportTable title="Completed refunds" description="Refunds completed during the selected period." headers={['Currency', 'Refunds', 'Amount']} rows={report.refunds.map((row) => [row.currency, row.count, row.amount])} empty="No completed refunds in this date range." />
        <ReportTable title="Fee adjustments" description="Saved scholarship, discount, concession, waiver, price override, surcharge, late fee, and tax amounts on demands issued during the period." headers={['Currency', 'Scholarship', 'Discount', 'Concession', 'Waiver', 'Override', 'Surcharge', 'Late fee', 'Tax']} rows={report.feeAdjustments.map((row) => [row.currency, row.scholarship, row.discount, row.concession, row.waiver, row.override, row.surcharge, row.lateFee, row.tax])} empty="No issued demand adjustments in this date range." />
        <ReportTable title="Operational corrections" description="Applied credit and debit adjustments, waivers, and write-offs recorded during the period." headers={['Currency', 'Type', 'Direction', 'Count', 'Amount']} rows={report.operationalAdjustments.map((row) => [row.currency, row.kind.replaceAll('_', ' '), row.direction, row.count, row.amount])} empty="No operational adjustments in this date range." />
      </div>
    </>}
  </main>;
}

function ReportTable({ title, description, headers, rows, empty }: { title: string; description: string; headers: string[]; rows: Array<Array<string | number>>; empty: string }) {
  return <section className="surface-panel report-table-panel"><div className="section-heading section-heading-panel"><div><h2>{title}</h2><p>{description}</p></div></div>{rows.length ? <div className="table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${index}-${row[0]}`}>{row.map((cell, cellIndex) => <td key={`${index}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div> : <div className="empty-state"><p>{empty}</p></div>}</section>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }
