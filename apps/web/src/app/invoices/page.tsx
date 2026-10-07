'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { useSession } from '../../components/session-provider';
import { FileText, Printer, ReceiptText } from 'lucide-react';

interface Invoice { id: string; invoiceNumber: string; studentId: string | null; demandId: string | null; status: string; issueDate: string; dueDate: string; totalAmount: string; adjustmentAmount: string; paidAmount: string; currency: string }
interface Demand { id: string; demandNumber: string; studentId: string; currency: string; dueDate: string; netAmount: string; adjustmentAmount: string; status: string }
interface InvoiceLine { id: string; description: string; feeTypeCode: string | null; quantity: string; unitAmount: string; taxPercent: string | null; amount: string; sequence: number }
interface InvoiceAdjustment { id: string; adjustmentNumber: string; kind: string; direction: string; amount: string; currency: string; reason: string; status: string }
interface InvoiceDetail extends Invoice { snapshot: Record<string, unknown> | null; lines: InvoiceLine[]; demand: { id: string; demandNumber: string; studentId: string; financialPeriod: string | null } | null; operationalAdjustments: InvoiceAdjustment[]; alreadyExisted?: boolean }

export default function InvoicesPage() {
  const { user } = useSession();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [demands, setDemands] = useState<Demand[]>([]);
  const [selected, setSelected] = useState<InvoiceDetail | null>(null);
  const [demandId, setDemandId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const canRead = hasPermission(user, 'invoice.read');
  const canCreate = hasPermission(user, 'invoice.create');

  const load = useCallback(async () => {
    if (!canRead) return;
    try {
      const [invoiceRows, demandPage] = await Promise.all([
        apiRequest<Invoice[]>('/invoices?pageSize=100'),
        apiRequest<{ items: Demand[] }>('/fee-demands?pageSize=100'),
      ]);
      setInvoices(invoiceRows); setDemands(demandPage.items); setError('');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Invoice records could not be loaded.'); }
  }, [canRead]);
  useEffect(() => { void load(); }, [load]);

  const eligibleDemands = useMemo(() => {
    const invoiced = new Set(invoices.map((invoice) => invoice.demandId).filter(Boolean));
    return demands.filter((demand) => ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID'].includes(demand.status) && !invoiced.has(demand.id));
  }, [demands, invoices]);

  async function issueInvoice() {
    if (!demandId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const invoice = await apiRequest<InvoiceDetail>(`/invoices/from-demand/${demandId}`, { method: 'POST', body: '{}' });
      setNotice(invoice.alreadyExisted ? 'An invoice already existed for that demand.' : `Invoice ${invoice.invoiceNumber} issued from the saved demand snapshot.`);
      setDemandId(''); await load(); setSelected(await apiRequest<InvoiceDetail>(`/invoices/${invoice.id}`));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Invoice could not be issued.'); }
    finally { setBusy(false); }
  }

  async function open(id: string) {
    setError('');
    try { setSelected(await apiRequest<InvoiceDetail>(`/invoices/${id}`)); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Invoice details could not be loaded.'); }
  }

  if (!canRead) return <main id="main-content" className="page-content"><div className="page-heading"><div><p className="eyebrow">FINANCE</p><h1>Invoices</h1></div></div><div className="notice notice-error" role="alert">Your role needs invoice read access to view billing records.</div></main>;

  const snapshot = selected?.snapshot ?? {};
  const organization = (snapshot.organization ?? snapshot.institution ?? {}) as { organizationName?: string; institutionName?: string; legalName?: string | null; addressLine1?: string | null; addressLine2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; country?: string | null; phone?: string | null; email?: string | null; invoiceFooter?: string | null };
  const student = (snapshot.student ?? {}) as { fullName?: string; admissionNumber?: string; email?: string | null; phone?: string | null };
  const totals = (snapshot.totals ?? {}) as { subtotal?: string; discountAmount?: string; taxAmount?: string; totalAmount?: string; currency?: string };
  const currency = selected?.currency ?? totals.currency ?? '';

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">FINANCE</p><h1>Invoices</h1><p className="muted">Issue a billing snapshot from a fee demand and keep payment progress attached to its source.</p></div><span className="heading-count"><FileText size={16} /> {invoices.length} invoices</span></div>
    {notice && <div className="notice notice-success" role="status">{notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    {canCreate && <section className="surface-panel invoice-create-panel"><div className="section-heading section-heading-panel"><div><h2>Issue from fee demand</h2><p>Only issued demand records can be invoiced. Each demand can have one invoice.</p></div></div><div className="invoice-create-row"><label>Fee demand<select value={demandId} onChange={(event) => setDemandId(event.target.value)}><option value="">Choose an eligible demand</option>{eligibleDemands.map((demand) => <option key={demand.id} value={demand.id}>{demand.demandNumber} · {demand.currency} {addDecimal(demand.netAmount, demand.adjustmentAmount)} · {demand.status}</option>)}</select></label><button className="button button-primary" disabled={!demandId || busy} onClick={() => void issueInvoice()}>{busy ? 'Issuing…' : 'Issue invoice'}</button></div></section>}
    <div className="invoice-layout"><section className="surface-panel invoice-list-panel"><div className="section-heading section-heading-panel"><div><h2>Invoice register</h2><p>Paid amount and status follow posted collections and refund reversals.</p></div></div>{invoices.length ? <div className="table-wrap"><table><thead><tr><th>Invoice</th><th>Demand</th><th>Issue date</th><th>Due date</th><th>Total</th><th>Paid</th><th>Status</th></tr></thead><tbody>{invoices.map((invoice) => <tr key={invoice.id} className={selected?.id === invoice.id ? 'selected-row' : ''}><td><button className="text-button mono-cell" onClick={() => void open(invoice.id)}>{invoice.invoiceNumber}</button></td><td className="mono-cell">{demands.find((demand) => demand.id === invoice.demandId)?.demandNumber ?? '—'}</td><td>{new Date(invoice.issueDate).toLocaleDateString()}</td><td>{new Date(invoice.dueDate).toLocaleDateString()}</td><td>{invoice.currency} {addDecimal(invoice.totalAmount, invoice.adjustmentAmount)}</td><td>{invoice.currency} {invoice.paidAmount}</td><td><span className={`status-pill ${invoice.status === 'PAID' ? 'status-green' : invoice.status === 'OVERDUE' ? 'status-red' : 'status-amber'}`}>{invoice.status.replaceAll('_', ' ')}</span></td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><FileText /></span><h2>No invoices yet</h2><p>Issue an invoice from an eligible fee demand to create a dated billing snapshot.</p></div>}</section>
      <section className="surface-panel invoice-preview-panel">{selected ? <><div className="invoice-printbar"><span className={`status-pill ${selected.status === 'PAID' ? 'status-green' : selected.status === 'OVERDUE' ? 'status-red' : 'status-amber'}`}>{selected.status.replaceAll('_', ' ')}</span><button className="button button-secondary button-small no-print" onClick={() => window.print()}><Printer size={14} /> Print invoice</button></div><article className="invoice-paper"><header className="invoice-paper-header"><div><p className="eyebrow">INVOICE</p><h2>{organization.organizationName ?? organization.institutionName ?? organization.legalName ?? 'Organization'}</h2><p>{[organization.addressLine1, organization.addressLine2, organization.city, organization.state, organization.postalCode, organization.country].filter(Boolean).join(', ')}</p><p>{[organization.phone, organization.email].filter(Boolean).join(' · ')}</p></div><div className="invoice-number"><span>Invoice no.</span><strong>{selected.invoiceNumber}</strong><span>Issued {new Date(selected.issueDate).toLocaleDateString()}</span></div></header><div className="invoice-parties"><div><span>Bill to</span><strong>{student.fullName ?? 'Student'}</strong><small>{student.admissionNumber ?? ''}</small><small>{[student.email, student.phone].filter(Boolean).join(' · ')}</small></div><div><span>Fee demand</span><strong>{selected.demand?.demandNumber ?? '—'}</strong><small>Due {new Date(selected.dueDate).toLocaleDateString()}</small><small>{selected.demand?.financialPeriod ?? ''}</small></div></div><table className="invoice-lines-table"><thead><tr><th>Description</th><th>Code</th><th>Amount</th></tr></thead><tbody>{selected.lines.map((line) => <tr key={line.id}><td>{line.description}</td><td>{line.feeTypeCode ?? '—'}</td><td>{currency} {line.amount}</td></tr>)}</tbody><tfoot><tr><td colSpan={2}>Posted adjustments</td><td>{currency} {selected.adjustmentAmount}</td></tr><tr><th colSpan={2}>Current total due</th><th>{currency} {addDecimal(selected.totalAmount, selected.adjustmentAmount)}</th></tr><tr><td colSpan={2}>Paid</td><td>{currency} {selected.paidAmount}</td></tr><tr><th colSpan={2}>Balance</th><th>{currency} {exactDifference(addDecimal(selected.totalAmount, selected.adjustmentAmount), selected.paidAmount)}</th></tr></tfoot></table>{selected.operationalAdjustments.length > 0 && <div className="invoice-adjustment-history no-print"><strong>Adjustment history</strong>{selected.operationalAdjustments.map((row) => <p key={row.id}>{row.adjustmentNumber} · {enumKind(row.kind)} · {row.direction === 'CREDIT' ? '−' : '+'}{row.currency} {row.amount} · {row.reason} · {row.status.replaceAll('_', ' ')}</p>)}</div>}<p className="invoice-footer-note">{organization.invoiceFooter ?? 'Please retain this invoice for your records.'}</p></article></> : <div className="empty-state detail-empty"><span className="empty-icon"><ReceiptText /></span><h2>Select an invoice</h2><p>View the issue-time billing snapshot, saved lines, due date, and current settlement.</p></div>}</section></div>
    <style jsx global>{`@media print { .sidebar, .topbar, .page-heading, .invoice-create-panel, .invoice-list-panel, .invoice-printbar, .no-print { display: none !important; } .app-main { margin: 0 !important; } .page-content { padding: 0 !important; } .invoice-layout { display: block !important; } .invoice-preview-panel { border: 0 !important; box-shadow: none !important; } .invoice-paper { border: 0 !important; box-shadow: none !important; } }`}</style>
  </main>;
}

function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }
function exactDifference(total: string, paid: string): string { const difference = decimalUnits(total) - decimalUnits(paid); const negative = difference < 0n; const absolute = negative ? -difference : difference; return `${negative ? '-' : ''}${absolute / 10_000n}.${(absolute % 10_000n).toString().padStart(4, '0')}`; }
function addDecimal(left: string, right: string): string { const total = decimalUnits(left) + decimalUnits(right); const negative = total < 0n; const absolute = negative ? -total : total; return `${negative ? '-' : ''}${absolute / 10_000n}.${(absolute % 10_000n).toString().padStart(4, '0')}`; }
function decimalUnits(value: string): bigint { const [whole = '0', fraction = ''] = value.split('.'); return BigInt(`${whole}${fraction.padEnd(4, '0')}`); }
function enumKind(value: string): string { return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }
