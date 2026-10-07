'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ASSIGNMENT_TARGET_TYPES, FEE_FREQUENCIES, FEE_OPTIONALITIES, enumLabel } from '@fee/types';
import { ApiError, apiRequest } from '../../lib/api';
import { Plus, WalletCards, X } from 'lucide-react';

interface Structure { id: string; name: string; code: string; active: boolean; targetType: string; targetUnitId: string | null; academicYearId: string | null }
interface StructureItem { id?: string; feeTypeId: string; feeTypeVersionId?: string; amount: string; quantity?: string | null; percentBase?: string | null; frequency: string; optionality?: string; taxable?: boolean; taxPercent?: string | null; dueDate?: string | null }
interface StructureDetail extends Structure { versions: Array<{ id: string; version: number; status: string; effectiveFrom: string; effectiveTo: string | null; totalAmount: string | null; items: StructureItem[] }> }
interface FeeType { id: string; name: string; code: string; active: boolean; calculationMethod: string }
interface AcademicUnit { id: string; name: string; code: string; unitType: string }
interface AcademicYear { id: string; name: string; isCurrent: boolean; isClosed: boolean }
interface Page<T> { items: T[]; pagination: { total: number } }
interface ItemDraft { key: string; feeTypeId: string; amount: string; quantity: string; percentBase: string; frequency: string; optionality: string; taxable: boolean; taxPercent: string; dueDate: string }

function newItem(): ItemDraft {
  return { key: crypto.randomUUID(), feeTypeId: '', amount: '', quantity: '', percentBase: '', frequency: 'ANNUAL', optionality: 'MANDATORY', taxable: false, taxPercent: '', dueDate: '' };
}

function draftFrom(items: StructureItem[]): ItemDraft[] {
  return items.map((item) => ({
    key: crypto.randomUUID(), feeTypeId: item.feeTypeId, amount: item.amount, quantity: item.quantity ?? '',
    percentBase: item.percentBase ?? '', frequency: item.frequency, optionality: item.optionality ?? 'MANDATORY',
    taxable: item.taxable ?? false, taxPercent: item.taxPercent ?? '', dueDate: item.dueDate?.slice(0, 10) ?? '',
  }));
}

function payloadItems(items: ItemDraft[]) {
  return items.map((item, sortOrder) => ({
    feeTypeId: item.feeTypeId, amount: item.amount, quantity: item.quantity || null, percentBase: item.percentBase || null,
    frequency: item.frequency, optionality: item.optionality, taxable: item.taxable, taxPercent: item.taxable ? (item.taxPercent || null) : null,
    dueDate: item.dueDate || null, sortOrder,
  }));
}

function itemDetails(item: StructureItem): string {
  const details = [enumLabel(item.frequency), enumLabel(item.optionality ?? 'MANDATORY')];
  if (item.quantity) details.push(`quantity ${item.quantity}`);
  if (item.percentBase) details.push(`base ${item.percentBase}`);
  if (item.dueDate) details.push(`due ${new Date(item.dueDate).toLocaleDateString()}`);
  if (item.taxable) details.push(`taxable${item.taxPercent ? ` ${item.taxPercent}%` : ''}`);
  return details.join(' · ');
}

function FeeItemsEditor({ items, types, disabled, onChange }: { items: ItemDraft[]; types: FeeType[]; disabled: boolean; onChange: (items: ItemDraft[]) => void }) {
  function update(index: number, changes: Partial<ItemDraft>) {
    onChange(items.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item));
  }

  return <div className="fee-item-editor">
    {items.map((item, index) => {
      const feeType = types.find((type) => type.id === item.feeTypeId);
      return <fieldset className="fee-item-editor-row" key={item.key}>
        <legend>Fee item {index + 1}</legend>
        <button type="button" className="icon-button fee-item-remove" aria-label={`Remove fee item ${index + 1}`} disabled={disabled || items.length === 1} onClick={() => onChange(items.filter((_, itemIndex) => itemIndex !== index))}><X size={15} /></button>
        <label>Fee type<select required value={item.feeTypeId} disabled={disabled} onChange={(event) => update(index, { feeTypeId: event.target.value })}><option value="">Choose a fee type</option>{types.map((type) => <option key={type.id} value={type.id}>{type.name} ({type.code}) · {enumLabel(type.calculationMethod)}</option>)}</select></label>
        <label>{feeType?.calculationMethod === 'USAGE' ? 'Unit rate' : 'Amount / rate'}<input type="number" min="0" step="0.0001" required inputMode="decimal" value={item.amount} disabled={disabled} onChange={(event) => update(index, { amount: event.target.value })} /></label>
        {['QUANTITY', 'FORMULA', 'CUSTOM'].includes(feeType?.calculationMethod ?? '') && <label>Quantity{feeType?.calculationMethod !== 'QUANTITY' && ' (optional)'}<input type="number" min="0.0001" step="0.0001" required={feeType?.calculationMethod === 'QUANTITY'} inputMode="decimal" value={item.quantity} disabled={disabled} onChange={(event) => update(index, { quantity: event.target.value })} /></label>}
        {['PERCENTAGE', 'FORMULA', 'CUSTOM'].includes(feeType?.calculationMethod ?? '') && <label>Percentage base{feeType?.calculationMethod !== 'PERCENTAGE' && ' (optional)'}<input type="number" min="0" step="0.0001" required={feeType?.calculationMethod === 'PERCENTAGE'} inputMode="decimal" value={item.percentBase} disabled={disabled} onChange={(event) => update(index, { percentBase: event.target.value })} /></label>}
        <label>Frequency<select value={item.frequency} disabled={disabled} onChange={(event) => update(index, { frequency: event.target.value })}>{FEE_FREQUENCIES.map((value) => <option key={value} value={value}>{enumLabel(value)}</option>)}</select></label>
        <label>Requirement<select value={item.optionality} disabled={disabled} onChange={(event) => update(index, { optionality: event.target.value })}>{FEE_OPTIONALITIES.map((value) => <option key={value} value={value}>{enumLabel(value)}</option>)}</select></label>
        <label>Due date<input type="date" value={item.dueDate} disabled={disabled} onChange={(event) => update(index, { dueDate: event.target.value })} /></label>
        <label className="fee-item-tax-toggle"><input type="checkbox" checked={item.taxable} disabled={disabled} onChange={(event) => update(index, { taxable: event.target.checked })} /> Taxable</label>
        {item.taxable && <label>Tax rate (%) · blank uses fee type default<input type="number" min="0" max="100" step="0.000001" inputMode="decimal" value={item.taxPercent} disabled={disabled} onChange={(event) => update(index, { taxPercent: event.target.value })} /></label>}
      </fieldset>;
    })}
    <button type="button" className="button button-secondary button-small" disabled={disabled || items.length >= 200} onClick={() => onChange([...items, newItem()])}><Plus size={15} /> Add fee item</button>
  </div>;
}

export default function FeeStructuresPage() {
  const [structures, setStructures] = useState<Structure[]>([]); const [types, setTypes] = useState<FeeType[]>([]); const [units, setUnits] = useState<AcademicUnit[]>([]); const [years, setYears] = useState<AcademicYear[]>([]); const [selected, setSelected] = useState<StructureDetail | null>(null);
  const [createItems, setCreateItems] = useState<ItemDraft[]>([newItem()]); const [versionItems, setVersionItems] = useState<ItemDraft[]>([]); const [versionOpen, setVersionOpen] = useState(false); const [closingVersion, setClosingVersion] = useState<string | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const [structurePage, typePage, unitPage, yearPage] = await Promise.all([apiRequest<Page<Structure>>('/fee-structures?pageSize=100'), apiRequest<Page<FeeType>>('/fee-types?pageSize=100'), apiRequest<Page<AcademicUnit>>('/academic-units?pageSize=100'), apiRequest<Page<AcademicYear>>('/academic-years?pageSize=100')]); setStructures(structurePage.items); setTypes(typePage.items.filter((type) => type.active)); setUnits(unitPage.items); setYears(yearPage.items.filter((year) => !year.isClosed)); setError(''); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Fee structures could not be loaded.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function open(id: string) {
    setError('');
    try { setSelected(await apiRequest<StructureDetail>(`/fee-structures/${id}`)); setVersionOpen(false); setClosingVersion(null); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Structure detail could not be loaded.'); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); setBusy(true); setError('');
    try {
      const created = await apiRequest<Structure & { draftVersionId: string }>('/fee-structures', { method: 'POST', body: JSON.stringify({ name: values.get('name'), code: values.get('code'), academicYearId: values.get('academicYearId') || null, targetType: values.get('targetType'), targetUnitId: values.get('targetUnitId') || null, effectiveFrom: values.get('effectiveFrom'), notes: values.get('notes') || null, items: payloadItems(createItems) }) });
      form.reset(); setCreateItems([newItem()]); setNotice('Draft schedule created. Review its items and publish when ready.'); await load(); await open(created.id);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Fee structure could not be created.'); }
    finally { setBusy(false); }
  }

  async function createVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected) return; const values = new FormData(event.currentTarget); setBusy(true); setError('');
    try {
      await apiRequest(`/fee-structures/${selected.id}/versions`, { method: 'POST', body: JSON.stringify({ effectiveFrom: values.get('effectiveFrom'), effectiveTo: values.get('effectiveTo') || null, notes: values.get('notes') || null, items: payloadItems(versionItems) }) });
      setVersionOpen(false); setNotice('Draft schedule version created. Close any overlapping active window before publishing.'); await open(selected.id);
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Fee structure version could not be created.'); }
    finally { setBusy(false); }
  }

  async function publish(versionId: string) {
    if (!selected) return; setBusy(true); setError('');
    try { await apiRequest(`/fee-structures/${selected.id}/versions/${versionId}/publish`, { method: 'POST', body: '{}' }); setNotice('Fee structure version published.'); await open(selected.id); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Structure version could not be published.'); }
    finally { setBusy(false); }
  }

  async function closeVersion(event: FormEvent<HTMLFormElement>, versionId: string) {
    if (!selected) return; event.preventDefault(); const values = new FormData(event.currentTarget); setBusy(true); setError('');
    try { await apiRequest(`/fee-structures/${selected.id}/versions/${versionId}/close`, { method: 'POST', body: JSON.stringify({ effectiveTo: values.get('effectiveTo'), reason: values.get('reason') }) }); setClosingVersion(null); setNotice('Active schedule window closed and recorded in the audit history.'); await open(selected.id); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Schedule window could not be closed.'); }
    finally { setBusy(false); }
  }

  function startVersion() {
    if (!selected) return;
    const latest = selected.versions[0]; setVersionItems(latest?.items.length ? draftFrom(latest.items) : [newItem()]); setVersionOpen(true); setClosingVersion(null);
  }

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">CONFIGURATION</p><h1>Fee structures</h1><p className="muted">Build dated schedules from reusable fee types and academic scopes.</p></div><span className="heading-count"><WalletCards size={17} /> {structures.length} schedules</span></div>
    {notice && <div className="notice notice-success" role="status">{notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    <div className="structure-layout">
      <section className="surface-panel">
        <div className="section-heading section-heading-panel"><div><h2>Schedules</h2><p>Select a schedule to review its versions.</p></div>
          <details className="create-menu"><summary className="button button-primary"><Plus size={16} /> Create schedule</summary>
            <form className="popover-form wide-popover" onSubmit={create}>
              <strong>New fee schedule</strong>
              <label>Name<input name="name" required maxLength={160} /></label><label>Code<input name="code" required maxLength={32} /></label>
              <label>Academic year<select name="academicYearId" defaultValue=""><option value="">All years</option>{years.map((year) => <option key={year.id} value={year.id}>{year.name}{year.isCurrent ? ' · Current' : ''}</option>)}</select></label>
              <label>Academic target<select name="targetType" defaultValue="CLASS">{ASSIGNMENT_TARGET_TYPES.map((value) => <option key={value} value={value}>{enumLabel(value)}</option>)}</select></label>
              <label>Academic unit<select name="targetUnitId" defaultValue=""><option value="">All units in target type</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name} ({enumLabel(unit.unitType)})</option>)}</select></label>
              <label>Effective from<input type="date" name="effectiveFrom" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
              <label>Notes<textarea name="notes" rows={2} /></label>
              <FeeItemsEditor items={createItems} types={types} disabled={busy} onChange={setCreateItems} />
              <button className="button button-primary button-wide" disabled={busy || !types.length}>{busy ? 'Saving…' : 'Create draft schedule'}</button>
            </form>
          </details>
        </div>
        {structures.length ? <div className="structure-list">{structures.map((item) => <button key={item.id} className={`structure-row ${selected?.id === item.id ? 'selected' : ''}`} onClick={() => void open(item.id)}><span className="structure-row-icon"><WalletCards size={17} /></span><span className="structure-row-copy"><strong>{item.name}</strong><small>{item.code} · {enumLabel(item.targetType)}</small></span><span className={`status-pill ${item.active ? 'status-green' : 'status-gray'}`}>{item.active ? 'Active' : 'Inactive'}</span></button>)}</div> : <div className="empty-state"><span className="empty-icon"><WalletCards /></span><h2>No fee schedules yet</h2><p>Use the catalog fee types to create your first dated schedule.</p></div>}
      </section>
      <section className="surface-panel detail-panel">
        {selected ? <>
          <div className="section-heading section-heading-panel"><div><p className="eyebrow">SCHEDULE DETAILS</p><h2>{selected.name}</h2><p>{selected.code} · {enumLabel(selected.targetType)}</p></div><button className="button button-secondary button-small" disabled={busy} onClick={startVersion}><Plus size={15} /> New version</button></div>
          {versionOpen && <form className="popover-form version-create-form" onSubmit={createVersion}>
            <strong>New version · items copied from the latest version</strong>
            <label>Effective from<input type="date" name="effectiveFrom" required defaultValue={new Date().toISOString().slice(0, 10)} /></label>
            <label>Effective to (optional)<input type="date" name="effectiveTo" /></label><label>Notes<textarea name="notes" rows={2} /></label>
            <FeeItemsEditor items={versionItems} types={types} disabled={busy} onChange={setVersionItems} />
            <div className="button-row"><button className="button button-primary button-small" disabled={busy}>{busy ? 'Saving…' : 'Create version draft'}</button><button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => setVersionOpen(false)}>Cancel</button></div>
          </form>}
          {selected.versions.map((version) => <article className="version-card" key={version.id}>
            <div className="version-heading"><div><strong>Version {version.version}</strong><span className={`status-pill ${version.status === 'ACTIVE' ? 'status-green' : 'status-gray'}`}>{enumLabel(version.status)}</span></div>{version.status === 'DRAFT' && <button className="button button-secondary button-small" disabled={busy} onClick={() => void publish(version.id)}>Publish</button>}{version.status === 'ACTIVE' && !version.effectiveTo && <button className="button button-secondary button-small" disabled={busy} onClick={() => setClosingVersion(closingVersion === version.id ? null : version.id)}>Close window</button>}</div>
            <p className="version-date">Effective {new Date(version.effectiveFrom).toLocaleDateString()}{version.effectiveTo ? ` – ${new Date(version.effectiveTo).toLocaleDateString()}` : ' · no end date'}</p>
            {closingVersion === version.id && <form className="version-close-form" onSubmit={(event) => void closeVersion(event, version.id)}><label>Last effective date<input type="date" name="effectiveTo" required min={new Date().toISOString().slice(0, 10)} defaultValue={new Date().toISOString().slice(0, 10)} /></label><label>Reason<input name="reason" required maxLength={1000} placeholder="Why is this schedule being superseded?" /></label><button className="button button-primary button-small" disabled={busy}>{busy ? 'Saving…' : 'Close active window'}</button></form>}
            <div className="version-items">{version.items.map((item, index) => <div className="version-item" key={item.id ?? `${item.feeTypeId}-${index}`}><span>{types.find((type) => type.id === item.feeTypeId)?.name ?? 'Fee item'}<small>{itemDetails(item)}</small></span><strong>{item.amount}</strong></div>)}</div>
            {version.totalAmount !== null && <div className="version-total"><span>Published schedule total</span><strong>{version.totalAmount}</strong></div>}
          </article>)}
        </> : <div className="empty-state detail-empty"><span className="empty-icon"><WalletCards /></span><h2>Select a schedule</h2><p>Its effective dates, fee items, and publication status will appear here.</p></div>}
      </section>
    </div>
  </main>;
}
