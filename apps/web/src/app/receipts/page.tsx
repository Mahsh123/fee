'use client';
import { formatIndianCurrency, formatIndianDate } from '../../lib/locale';

import { useCallback, useEffect, useState } from 'react';
import { ApiError, apiRequest } from '../../lib/api';
import { Printer, ReceiptText } from 'lucide-react';

interface Receipt { id: string; receiptNumber: string; issueDate: string; totalAmount: string; currency: string; snapshot: Record<string, unknown>; lines?: ReceiptLine[] }
interface ReceiptLine { id?: string; feeTypeCode: string; feeTypeName: string; description: string | null; amount: string; allocatedAmount: string; sequence: number }
interface ReceiptDetail extends Receipt { lines: ReceiptLine[]; paymentId: string; status: string }
interface Page<T> { items: T[]; pagination: { total: number } }
interface Branding { organizationName?: string; institutionName?: string; legalName?: string | null; addressLine1?: string | null; addressLine2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; country?: string | null; phone?: string | null; email?: string | null; receiptFooter?: string | null }

export default function ReceiptsPage() {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [selected, setSelected] = useState<ReceiptDetail | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { const page = await apiRequest<Page<Receipt>>('/receipts?pageSize=100&sort=-issueDate'); setReceipts(page.items); setError(''); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Receipts could not be loaded.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function open(id: string) { setError(''); try { setSelected(await apiRequest<ReceiptDetail>(`/receipts/${id}`)); } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Receipt details could not be loaded.'); } }
  const snapshot = selected?.snapshot ?? {};
  const branding = (snapshot.organization ?? snapshot.institution) as Branding | null | undefined;
  const student = snapshot.student as { fullName?: string; admissionNumber?: string } | undefined;
  const payer = snapshot.payer as { name?: string | null; type?: string } | undefined;
  const payment = snapshot.payment as { paymentNumber?: string; method?: string; referenceNumber?: string | null } | undefined;

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">FINANCE</p><h1>Receipts</h1><p className="muted">Reprint the receipt snapshot exactly as it was issued, even after later branding changes.</p></div><span className="heading-count"><ReceiptText size={16} /> {receipts.length} receipts</span></div>
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    <div className="receipt-layout"><section className="surface-panel receipt-list-panel"><div className="section-heading section-heading-panel"><div><h2>Issued receipts</h2><p>Select a receipt to view its saved snapshot.</p></div></div>{receipts.length ? <div className="receipt-list">{receipts.map((receipt) => <button className={`receipt-list-row ${selected?.id === receipt.id ? 'selected-row' : ''}`} key={receipt.id} onClick={() => void open(receipt.id)}><span><strong>{receipt.receiptNumber}</strong><small>{formatIndianDate(new Date(receipt.issueDate))}</small></span><b>{formatIndianCurrency(receipt.totalAmount, receipt.currency)}</b></button>)}</div> : <div className="empty-state"><span className="empty-icon"><ReceiptText /></span><h2>No receipts yet</h2><p>Successful manual collections create receipt records automatically.</p></div>}</section>
      <section className="surface-panel receipt-preview-panel">{selected ? <>
        <div className="receipt-printbar"><span className="status-pill status-green">{selected.status}</span><button className="button button-secondary button-small no-print" onClick={() => window.print()}><Printer size={14} /> Print receipt</button></div>
        <article className="receipt-paper"><header className="receipt-paper-header"><div><p className="eyebrow">PAYMENT RECEIPT</p><h2>{branding?.organizationName ?? branding?.institutionName ?? branding?.legalName ?? 'Organization'}</h2><p>{[branding?.addressLine1, branding?.addressLine2, branding?.city, branding?.state, branding?.postalCode, branding?.country].filter(Boolean).join(', ')}</p><p>{[branding?.phone, branding?.email].filter(Boolean).join(' · ')}</p></div><div className="receipt-paper-number"><span>Receipt no.</span><strong>{selected.receiptNumber}</strong><span>{formatIndianDate(new Date(selected.issueDate))}</span></div></header>
          <div className="receipt-parties"><div><span>Received from</span><strong>{payer?.name || student?.fullName || 'Student'}</strong><small>{payer?.type ?? 'STUDENT'}{student?.admissionNumber ? ` · ${student.admissionNumber}` : ''}</small></div><div><span>Payment</span><strong>{payment?.paymentNumber ?? selected.paymentId}</strong><small>{payment?.method ?? 'Manual payment'}{payment?.referenceNumber ? ` · ${payment.referenceNumber}` : ''}</small></div></div>
          <table className="receipt-lines-table"><thead><tr><th>Fee / item</th><th>Description</th><th>Amount</th><th>Applied</th></tr></thead><tbody>{selected.lines.map((line, index) => <tr key={line.id ?? index}><td>{line.feeTypeName}</td><td>{line.description ?? '—'}</td><td>{formatIndianCurrency(line.amount, selected.currency)}</td><td>{formatIndianCurrency(line.allocatedAmount, selected.currency)}</td></tr>)}</tbody><tfoot><tr><th colSpan={2}>Total received</th><th colSpan={2}>{formatIndianCurrency(selected.totalAmount, selected.currency)}</th></tr></tfoot></table>
          <p className="receipt-footer-note">{branding?.receiptFooter ?? 'Thank you. Keep this receipt for your records.'}</p>
        </article>
      </> : <div className="empty-state detail-empty"><span className="empty-icon"><ReceiptText /></span><h2>Select a receipt</h2><p>Receipt totals, branding, payer, and allocation lines are read from the immutable issue-time snapshot.</p></div>}</section></div>
    <style jsx global>{`@media print { .sidebar, .topbar, .page-heading, .receipt-list-panel, .receipt-printbar, .no-print { display: none !important; } .app-main { margin: 0 !important; } .page-content { padding: 0 !important; } .receipt-layout { display: block !important; } .receipt-preview-panel { border: 0 !important; box-shadow: none !important; } .receipt-paper { border: 0 !important; box-shadow: none !important; } }`}</style>
  </main>;
}
