'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { FEE_CALCULATION_METHODS, FEE_CATEGORY_KINDS, FEE_FREQUENCIES, FEE_OPTIONALITIES, enumLabel } from '@fee/types';
import { ApiError, apiRequest } from '../../lib/api';
import { Plus, ReceiptText } from 'lucide-react';

interface Category { id: string; name: string; code: string; kind: string; active: boolean }
interface FeeType { id: string; categoryId: string; name: string; code: string; calculationMethod: string; defaultFrequency: string; optionality: string; active: boolean; draftVersionId?: string }
interface TypeVersion {
  id: string; version: number; status: string; effectiveFrom: string; effectiveTo: string | null;
  calculationMethod: string; defaultFrequency: string; optionality: string; taxable: boolean; taxPercent: string | null;
  applicabilityRule: Record<string, unknown> | null;
  calculationConfig: { kind: string; quantityPath?: string; expression?: string } | null;
}
interface Page<T> { items: T[]; pagination: { total: number } }

export default function FeeCatalogPage() {
  const [categories, setCategories] = useState<Category[]>([]); const [types, setTypes] = useState<FeeType[]>([]); const [versions, setVersions] = useState<Record<string, TypeVersion[]>>({});
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false);
  const [calculationMethod, setCalculationMethod] = useState('FIXED');
  const load = useCallback(async () => {
    try {
      setError('');
      const [categoryPage, typePage] = await Promise.all([apiRequest<Page<Category>>('/fee-categories?pageSize=100'), apiRequest<Page<FeeType>>('/fee-types?pageSize=100')]);
      setCategories(categoryPage.items); setTypes(typePage.items);
      const versionRows = await Promise.all(typePage.items.map(async (feeType) => [feeType.id, await apiRequest<TypeVersion[]>(`/fee-types/${feeType.id}/versions`)] as const));
      setVersions(Object.fromEntries(versionRows));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Fee catalog could not be loaded.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); setBusy(true); setError('');
    try { await apiRequest('/fee-categories', { method: 'POST', body: JSON.stringify({ name: values.get('name'), code: values.get('code'), kind: values.get('kind'), description: values.get('description') || null }) }); form.reset(); setNotice('Fee category created.'); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Category could not be saved.'); } finally { setBusy(false); }
  }
  async function createType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); setBusy(true); setError('');
    const method = String(values.get('calculationMethod'));
    const calculationConfig = method === 'USAGE'
      ? { schemaVersion: 1, kind: 'USAGE', quantityPath: values.get('quantityPath') }
      : method === 'FORMULA' || method === 'CUSTOM'
        ? { schemaVersion: 1, kind: method, expression: values.get('expression') }
        : null;
    try { await apiRequest('/fee-types', { method: 'POST', body: JSON.stringify({ categoryId: values.get('categoryId'), name: values.get('name'), code: values.get('code'), calculationMethod: method, calculationConfig, defaultFrequency: values.get('defaultFrequency'), optionality: values.get('optionality'), taxable: values.get('taxable') === 'on', taxPercent: values.get('taxPercent') || null }) }); form.reset(); setCalculationMethod('FIXED'); setNotice('Fee type created with a draft configuration version. Publish that version to use it in schedules.'); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Fee type could not be saved.'); } finally { setBusy(false); }
  }
  async function publish(feeTypeId: string, versionId: string) {
    setBusy(true); setError('');
    try { await apiRequest(`/fee-types/${feeTypeId}/versions/${versionId}/publish`, { method: 'POST', body: '{}' }); setNotice('Fee type version published.'); await load(); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Fee type version could not be published.'); } finally { setBusy(false); }
  }
  async function createVersion(event: FormEvent<HTMLFormElement>, feeTypeId: string) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); setBusy(true); setError('');
    const method = String(values.get('calculationMethod'));
    const calculationConfig = method === 'USAGE'
      ? { schemaVersion: 1, kind: 'USAGE', quantityPath: values.get('quantityPath') }
      : method === 'FORMULA' || method === 'CUSTOM'
        ? { schemaVersion: 1, kind: method, expression: values.get('expression') }
        : null;
    const previous = versions[feeTypeId]?.[0];
    try {
      await apiRequest(`/fee-types/${feeTypeId}/versions`, { method: 'POST', body: JSON.stringify({
        effectiveFrom: values.get('effectiveFrom'), effectiveTo: values.get('effectiveTo') || null,
        calculationMethod: method, calculationConfig,
        defaultFrequency: values.get('defaultFrequency'), optionality: values.get('optionality'),
        taxable: values.get('taxable') === 'on', taxPercent: values.get('taxPercent') || null,
        applicabilityRule: previous?.applicabilityRule ?? null,
      }) });
      form.reset(); setNotice('New fee type version saved as a draft. Publish it when ready to use.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Fee type version could not be saved.'); }
    finally { setBusy(false); }
  }
  async function closeVersion(event: FormEvent<HTMLFormElement>, feeTypeId: string, versionId: string) {
    event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); setBusy(true); setError('');
    try {
      await apiRequest(`/fee-types/${feeTypeId}/versions/${versionId}/close`, { method: 'POST', body: JSON.stringify({ effectiveTo: values.get('effectiveTo'), reason: values.get('reason') }) });
      form.reset(); setNotice('Fee type version window closed. Existing demand calculations stay as recorded.'); await load();
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Fee type version window could not be closed.'); }
    finally { setBusy(false); }
  }

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">CONFIGURATION</p><h1>Fee catalog</h1><p className="muted">Create reusable fee definitions; amounts live in dated fee structures.</p></div><span className="heading-count"><ReceiptText size={17} /> {types.length} fee types</span></div>
    {notice && <div className="notice notice-success" role="status">{notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    <div className="catalog-layout">
      <section className="surface-panel"><div className="section-heading section-heading-panel"><div><h2>Fee categories</h2><p>Organize fee types by purpose.</p></div><details className="create-menu"><summary className="icon-button" aria-label="Add fee category"><Plus size={18} /></summary><form className="popover-form" onSubmit={createCategory}><strong>New category</strong><label>Name<input name="name" required maxLength={120} /></label><label>Code<input name="code" required maxLength={32} placeholder="TUITION" /></label><label>Category type<select name="kind" defaultValue="OTHER">{FEE_CATEGORY_KINDS.map((v) => <option key={v} value={v}>{enumLabel(v)}</option>)}</select></label><label>Description<textarea name="description" rows={2} /></label><button className="button button-primary button-wide" disabled={busy}>{busy ? 'Saving…' : 'Create category'}</button></form></details></div>
        {categories.length ? <div className="category-list">{categories.map((category) => <div className="category-row" key={category.id}><span className="category-icon"><ReceiptText size={16} /></span><span><strong>{category.name}</strong><small>{category.code} · {enumLabel(category.kind)}</small></span><span className={`status-pill ${category.active ? 'status-green' : 'status-gray'}`}>{category.active ? 'Active' : 'Inactive'}</span></div>)}</div> : <div className="compact-empty">Categories will appear here when created.</div>}</section>
      <section className="surface-panel"><div className="section-heading section-heading-panel"><div><h2>Fee types</h2><p>Names and calculation behavior, versioned over time.</p></div><details className="create-menu"><summary className="button button-primary"><Plus size={16} /> Add fee type</summary><form className="popover-form wide-popover" onSubmit={createType}><strong>New fee type</strong><label>Name<input name="name" required maxLength={120} /></label><label>Code<input name="code" required maxLength={32} placeholder="TUITION" /></label><label>Category<select name="categoryId" required defaultValue="">{!categories.length && <option value="">Add a category first</option>}{categories.filter((c) => c.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Calculation method<select name="calculationMethod" defaultValue="FIXED" onChange={(event) => setCalculationMethod(event.target.value)}>{FEE_CALCULATION_METHODS.map((v) => <option key={v} value={v}>{enumLabel(v)}</option>)}</select></label>{calculationMethod === 'USAGE' && <><label>Usage quantity field<input name="quantityPath" required defaultValue="student.customAttributes.usageUnits" placeholder="student.customAttributes.mealUnits" /></label><small className="muted">Choose a numeric student field. The schedule amount is the unit rate.</small></>}{(calculationMethod === 'FORMULA' || calculationMethod === 'CUSTOM') && <><label>Calculation expression<input name="expression" required maxLength={512} defaultValue="fee.amount * fee.quantity" placeholder="fee.amount * student.academicScore" /></label><small className="muted">Use numbers, + − × ÷, parentheses, and numeric fields such as fee.amount, fee.quantity, fee.percentBase, student.academicScore, or student.customAttributes.mealUnits. Custom calculations use this same safe expression editor; scripts are never run.</small></>}<label>Frequency<select name="defaultFrequency" defaultValue="ANNUAL">{FEE_FREQUENCIES.map((v) => <option key={v} value={v}>{enumLabel(v)}</option>)}</select></label><label>Optionality<select name="optionality" defaultValue="MANDATORY">{FEE_OPTIONALITIES.map((v) => <option key={v} value={v}>{enumLabel(v)}</option>)}</select></label><label className="inline-check"><input name="taxable" type="checkbox" /> Taxable</label><label>Tax rate (%)<input name="taxPercent" inputMode="decimal" placeholder="0" /></label><button className="button button-primary button-wide" disabled={busy || !categories.some((c) => c.active)}>{busy ? 'Saving…' : 'Create fee type'}</button></form></details></div>
        {types.length ? <div className="table-wrap"><table><thead><tr><th>Fee type</th><th>Method</th><th>Frequency</th><th>Version</th><th></th></tr></thead><tbody>{types.map((feeType) => { const drafts = (versions[feeType.id] ?? []).filter((v) => v.status === 'DRAFT' || v.status === 'PENDING_APPROVAL'); const current = (versions[feeType.id] ?? [])[0]; return <tr key={feeType.id}><td><strong>{feeType.name}</strong><small className="table-subtext">{feeType.code} · {categories.find((c) => c.id === feeType.categoryId)?.name ?? 'Category'}</small></td><td>{enumLabel(feeType.calculationMethod)}</td><td>{enumLabel(feeType.defaultFrequency)}</td><td>{current ? <span className={`status-pill ${current.status === 'ACTIVE' ? 'status-green' : 'status-gray'}`}>v{current.version} · {enumLabel(current.status)}</span> : '—'}</td><td><FeeTypeVersionActions feeType={feeType} versions={versions[feeType.id] ?? []} busy={busy} onPublish={publish} onClose={closeVersion} onCreate={createVersion} /></td></tr>; })}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><ReceiptText /></span><h2>Catalog is ready to configure</h2><p>Create a category first, then add fee types for this institution.</p></div>}</section>
    </div>
  </main>;
}

function FeeTypeVersionForm({ feeType, previous, busy, onSave }: {
  feeType: FeeType;
  previous?: TypeVersion;
  busy: boolean;
  onSave: (event: FormEvent<HTMLFormElement>, feeTypeId: string) => Promise<void>;
}) {
  const [method, setMethod] = useState(previous?.calculationMethod ?? feeType.calculationMethod);
  return <details className="create-menu"><summary className="text-button">New version</summary><form className="popover-form wide-popover" onSubmit={(event) => void onSave(event, feeType.id)}>
    <strong>New dated version for {feeType.name}</strong>
    <label>Effective from<input name="effectiveFrom" type="date" required defaultValue={previous?.effectiveTo ? followingDate(previous.effectiveTo) : new Date().toISOString().slice(0, 10)} /></label>
    <label>Effective to<input name="effectiveTo" type="date" /></label>
    <label>Calculation method<select name="calculationMethod" defaultValue={method} onChange={(event) => setMethod(event.target.value)}>{FEE_CALCULATION_METHODS.map((value) => <option key={value} value={value}>{enumLabel(value)}</option>)}</select></label>
    {method === 'USAGE' && <><label>Usage quantity field<input name="quantityPath" required defaultValue={previous?.calculationConfig?.quantityPath ?? 'student.customAttributes.usageUnits'} /></label><small className="muted">The fee schedule amount is the unit rate. Choose a numeric student field.</small></>}
    {(method === 'FORMULA' || method === 'CUSTOM') && <><label>Calculation expression<input name="expression" required maxLength={512} defaultValue={previous?.calculationConfig?.expression ?? 'fee.amount * fee.quantity'} /></label><small className="muted">Use numeric facts such as fee.amount, fee.quantity, fee.percentBase, student.academicScore, or student.customAttributes.units with + − × ÷ and parentheses. Expressions are parsed safely; scripts are never run.</small></>}
    <label>Frequency<select name="defaultFrequency" defaultValue={previous?.defaultFrequency ?? 'ANNUAL'}>{FEE_FREQUENCIES.map((value) => <option key={value} value={value}>{enumLabel(value)}</option>)}</select></label>
    <label>Optionality<select name="optionality" defaultValue={previous?.optionality ?? 'MANDATORY'}>{FEE_OPTIONALITIES.map((value) => <option key={value} value={value}>{enumLabel(value)}</option>)}</select></label>
    <label className="inline-check"><input name="taxable" type="checkbox" defaultChecked={previous?.taxable ?? false} /> Taxable</label>
    <label>Tax rate (%)<input name="taxPercent" inputMode="decimal" defaultValue={previous?.taxPercent ?? ''} placeholder="0" /></label>
    <button className="button button-primary button-wide" disabled={busy}>{busy ? 'Saving…' : 'Save draft version'}</button>
  </form></details>;
}

function FeeTypeVersionActions({ feeType, versions, busy, onPublish, onClose, onCreate }: {
  feeType: FeeType;
  versions: TypeVersion[];
  busy: boolean;
  onPublish: (feeTypeId: string, versionId: string) => Promise<void>;
  onClose: (event: FormEvent<HTMLFormElement>, feeTypeId: string, versionId: string) => Promise<void>;
  onCreate: (event: FormEvent<HTMLFormElement>, feeTypeId: string) => Promise<void>;
}) {
  const drafts = versions.filter((version) => version.status === 'DRAFT' || version.status === 'PENDING_APPROVAL');
  const current = versions[0];
  const openActive = versions.find((version) => version.status === 'ACTIVE' && version.effectiveTo === null);
  return <>{drafts.map((version) => <button key={version.id} className="text-button" disabled={busy} onClick={() => void onPublish(feeType.id, version.id)}>Publish v{version.version}</button>)}{openActive ? <FeeTypeVersionCloseForm feeType={feeType} version={openActive} busy={busy} onClose={onClose} /> : !drafts.length ? <FeeTypeVersionForm feeType={feeType} previous={current} busy={busy} onSave={onCreate} /> : null}</>;
}

function FeeTypeVersionCloseForm({ feeType, version, busy, onClose }: {
  feeType: FeeType;
  version: TypeVersion;
  busy: boolean;
  onClose: (event: FormEvent<HTMLFormElement>, feeTypeId: string, versionId: string) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const versionStart = version.effectiveFrom.slice(0, 10);
  const defaultEnd = versionStart > today ? versionStart : today;
  return <details className="create-menu"><summary className="text-button">Close active version</summary><form className="popover-form" onSubmit={(event) => void onClose(event, feeType.id, version.id)}><strong>End {feeType.name} version {version.version}</strong><label>Effective through<input name="effectiveTo" type="date" required min={defaultEnd} defaultValue={defaultEnd} /></label><label>Reason<textarea name="reason" required minLength={1} maxLength={1000} rows={2} /></label><small className="muted">Only future applicability changes. Existing demand calculations stay as recorded.</small><button className="button button-primary button-wide" disabled={busy}>{busy ? 'Saving…' : 'Close version window'}</button></form></details>;
}

function followingDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}
