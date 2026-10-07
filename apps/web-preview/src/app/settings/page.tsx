'use client';

import { useCallback, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { LATE_FEE_MODES, OVERPAYMENT_POLICIES, PARTIAL_PAYMENT_POLICIES, ROUNDING_MODES, enumLabel } from '@fee/types';
import { ApiError, apiRequest, type SessionUser } from '../../lib/api';
import { useSession } from '../../components/session-provider';
import { useTenant } from '../../components/tenant-provider';
import { Building2, Check, Hash, Save, Settings2 } from 'lucide-react';

interface TenantSettings {
  currency: string; currencySymbol: string; currencyMinorUnits: number; roundingMode: string; timezone: string; locale: string; dateFormat: string;
  defaultAcademicYearId: string | null; lateFeeMode: string; lateFeeGraceDays: number; lateFeeFlatAmount: string; lateFeePerDay: string;
  lateFeePercent: string; lateFeeMaxAmount: string | null; lateFeeFeeTypeId: string | null; partialPaymentPolicy: string;
  lateFeePaymentTermDays: number;
  overpaymentPolicy: string; allowAdvancePayment: boolean; minimumPartialAmount: string | null; refundApprovalThreshold: string | null;
  waiverApprovalThreshold: string | null; adjustmentApprovalThreshold: string | null; reminderScheduleDays: number[]; allowNegativeDemand: boolean;
}
interface FeeTypeOption { id: string; code: string; name: string; category: { code: string; name: string } }
interface AcademicYearOption { id: string; name: string; startDate: string; endDate: string }
interface SettingsResponse { settings: TenantSettings; feeTypes: FeeTypeOption[]; academicYears: AcademicYearOption[] }
interface SettingsForm {
  currency: string; currencySymbol: string; currencyMinorUnits: number; roundingMode: string; timezone: string; locale: string; dateFormat: string;
  defaultAcademicYearId: string; lateFeeMode: string; lateFeeGraceDays: number; lateFeeFlatAmount: string; lateFeePerDay: string;
  lateFeePercent: string; lateFeeMaxAmount: string; lateFeeFeeTypeId: string; partialPaymentPolicy: string; overpaymentPolicy: string;
  lateFeePaymentTermDays: number;
  allowAdvancePayment: boolean; minimumPartialAmount: string; refundApprovalThreshold: string; waiverApprovalThreshold: string;
  adjustmentApprovalThreshold: string; reminderScheduleDays: string; allowNegativeDemand: boolean;
}
interface BrandingForm {
  organizationName: string; legalName: string; addressLine1: string; addressLine2: string; city: string; state: string; postalCode: string;
  country: string; phone: string; email: string; website: string; logoUrl: string; primaryColor: string; accentColor: string;
  landingTitle: string; landingDescription: string; landingActionLabel: string; receiptFooter: string; invoiceFooter: string; authorizedSignatory: string;
}
interface NumberingForm {
  receiptPrefix: string; invoicePrefix: string; paymentPrefix: string; demandPrefix: string; refundPrefix: string; creditNotePrefix: string; adjustmentPrefix: string; applicationPrefix: string;
  studentPrefix: string; padding: number; includeYear: boolean; separator: string; resetAnnually: boolean;
}

export default function SettingsPage() {
  const { user } = useSession();
  const tenant = useTenant();
  const enabledModules = tenant.kind === 'tenant' ? tenant.enabledModules : [];
  const hasAdmissions = enabledModules.includes('ADMISSIONS');
  const hasFees = enabledModules.includes('FEES');
  const hasPayments = enabledModules.includes('PAYMENTS');
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [feeTypes, setFeeTypes] = useState<FeeTypeOption[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYearOption[]>([]);
  const [branding, setBranding] = useState<BrandingForm | null>(null);
  const [numbering, setNumbering] = useState<NumberingForm | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canRead = hasPermission(user, 'tenant.settings.read');
  const canEdit = hasPermission(user, 'tenant.settings.update');
  const canEditBranding = hasPermission(user, 'tenant.branding.update');
  const canEditNumbering = hasPermission(user, 'tenant.numbering.update');

  const load = useCallback(async () => {
    if (!canRead) return;
    try {
      const [data, brandData, numberingData] = await Promise.all([
        apiRequest<SettingsResponse>('/settings/tenant'),
        apiRequest<Record<string, unknown>>('/settings/branding'),
        apiRequest<Record<string, unknown>>('/settings/numbering'),
      ]);
      setForm(toForm(data.settings)); setFeeTypes(data.feeTypes); setAcademicYears(data.academicYears);
      setBranding(toBrandingForm(brandData)); setNumbering(toNumberingForm(numberingData)); setError('');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Tenant settings could not be loaded.'); }
  }, [canRead]);
  useEffect(() => { void load(); }, [load]);

  function change<K extends keyof SettingsForm>(field: K, value: SettingsForm[K]) {
    setForm((current) => current ? { ...current, [field]: value } : current);
  }
  function textField(field: keyof SettingsForm) {
    return (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => change(field, event.target.value as never);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!form) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await apiRequest<TenantSettings>('/settings/tenant', { method: 'PATCH', body: JSON.stringify({
        currency: form.currency.trim().toUpperCase(), currencySymbol: form.currencySymbol, currencyMinorUnits: Number(form.currencyMinorUnits),
        roundingMode: form.roundingMode, timezone: form.timezone, locale: form.locale, dateFormat: form.dateFormat,
        defaultAcademicYearId: form.defaultAcademicYearId || null, lateFeeMode: form.lateFeeMode, lateFeeGraceDays: Number(form.lateFeeGraceDays),
        lateFeeFlatAmount: form.lateFeeFlatAmount || '0', lateFeePerDay: form.lateFeePerDay || '0', lateFeePercent: form.lateFeePercent || '0',
        lateFeeMaxAmount: form.lateFeeMaxAmount || null, lateFeeFeeTypeId: form.lateFeeFeeTypeId || null,
        lateFeePaymentTermDays: Number(form.lateFeePaymentTermDays),
        partialPaymentPolicy: form.partialPaymentPolicy, overpaymentPolicy: form.overpaymentPolicy, allowAdvancePayment: form.allowAdvancePayment,
        minimumPartialAmount: form.minimumPartialAmount || null, refundApprovalThreshold: form.refundApprovalThreshold || null,
        waiverApprovalThreshold: form.waiverApprovalThreshold || null, adjustmentApprovalThreshold: form.adjustmentApprovalThreshold || null,
        reminderScheduleDays: form.reminderScheduleDays.split(',').map((day) => Number(day.trim())).filter(Number.isFinite),
        allowNegativeDemand: form.allowNegativeDemand,
      }) });
      setForm(toForm(saved)); setNotice('Organization settings saved.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Organization settings could not be saved.'); }
    finally { setBusy(false); }
  }

  async function saveBranding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!branding) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await apiRequest<Record<string, unknown>>('/settings/branding', { method: 'PATCH', body: JSON.stringify(branding) });
      setBranding(toBrandingForm(saved)); setNotice('Organization branding saved. New receipts and invoices will use these details.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Organization branding could not be saved.'); }
    finally { setBusy(false); }
  }

  async function saveNumbering(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!numbering) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const saved = await apiRequest<Record<string, unknown>>('/settings/numbering', { method: 'PATCH', body: JSON.stringify(numbering) });
      setNumbering(toNumberingForm(saved)); setNotice('Document numbering preferences saved for new records.');
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Numbering preferences could not be saved.'); }
    finally { setBusy(false); }
  }

  if (!canRead) return <main id="main-content" className="page-content"><div className="page-heading"><div><p className="eyebrow">CONFIGURATION</p><h1>Organization settings</h1></div></div><div className="notice notice-error" role="alert">Your role needs tenant settings read access to view configuration.</div></main>;

  return <main id="main-content" className="page-content">
    <div className="page-heading"><div><p className="eyebrow">CONFIGURATION</p><h1>Organization settings</h1><p className="muted">Set currency, locale, and settings for the workspace’s enabled modules.</p></div><span className="heading-count"><Settings2 size={16} /> Tenant scoped</span></div>
    {notice && <div className="notice notice-success" role="status"><Check size={16} /> {notice}</div>}{error && <div className="notice notice-error" role="alert">{error}</div>}
    {!form ? <div className="surface-panel">Loading organization settings…</div> : <form className="tenant-settings-form" onSubmit={save}>
      <section className="surface-panel settings-section"><div className="section-heading section-heading-panel"><div><h2>Regional and currency</h2><p>These settings are used for dates, payment amounts, receipts, and reports.</p></div></div>
        <div className="settings-grid">
          <label>Currency code<input value={form.currency} onChange={textField('currency')} maxLength={3} required disabled={!canEdit} /></label>
          <label>Currency symbol<input value={form.currencySymbol} onChange={textField('currencySymbol')} maxLength={8} required disabled={!canEdit} /></label>
          <label>Minor units<input type="number" min={0} max={4} value={form.currencyMinorUnits} onChange={(event) => change('currencyMinorUnits', Number(event.target.value))} required disabled={!canEdit} /><small>Digits shown after the decimal separator.</small></label>
          <label>Rounding<select value={form.roundingMode} onChange={textField('roundingMode')} disabled={!canEdit}>{ROUNDING_MODES.map((mode) => <option key={mode} value={mode}>{enumLabel(mode)}</option>)}</select></label>
          <label>Timezone<input value={form.timezone} onChange={textField('timezone')} maxLength={64} required disabled={!canEdit} placeholder="Asia/Kolkata" /></label>
          <label>Locale<input value={form.locale} onChange={textField('locale')} maxLength={32} required disabled={!canEdit} placeholder="en-IN" /></label>
          <label>Date format<input value={form.dateFormat} onChange={textField('dateFormat')} maxLength={32} required disabled={!canEdit} /></label>
          {hasAdmissions && <label>Default academic year<select value={form.defaultAcademicYearId} onChange={textField('defaultAcademicYearId')} disabled={!canEdit}><option value="">No default</option>{academicYears.map((year) => <option key={year.id} value={year.id}>{year.name} · {dateOnly(year.startDate)} to {dateOnly(year.endDate)}</option>)}</select></label>}
        </div>
      </section>

      {hasFees && <>
      <section className="surface-panel settings-section"><div className="section-heading section-heading-panel"><div><h2>Late-fee policy</h2><p>Late fees use the selected tenant fee type and its active tax configuration. Accruals create separate draft demands.</p></div></div>
        <div className="settings-grid">
          <label>Calculation mode<select value={form.lateFeeMode} onChange={textField('lateFeeMode')} disabled={!canEdit}>{LATE_FEE_MODES.map((mode) => <option key={mode} value={mode}>{enumLabel(mode)}</option>)}</select></label>
          <label>Late-fee charge type<select value={form.lateFeeFeeTypeId} onChange={textField('lateFeeFeeTypeId')} disabled={!canEdit}><option value="">Choose a fee type</option>{feeTypes.map((type) => <option key={type.id} value={type.id}>{type.name} · {type.category.name}</option>)}</select><small>Only active fee types with an effective published version are listed.</small></label>
          <label>Grace days<input type="number" min={0} max={365} value={form.lateFeeGraceDays} onChange={(event) => change('lateFeeGraceDays', Number(event.target.value))} required disabled={!canEdit} /></label>
          <label>Days to pay the late fee<input type="number" min={0} max={365} value={form.lateFeePaymentTermDays} onChange={(event) => change('lateFeePaymentTermDays', Number(event.target.value))} required disabled={!canEdit} /><small>Days after accrual before the late-fee demand is due.</small></label>
          <label>Flat amount<input inputMode="decimal" value={form.lateFeeFlatAmount} onChange={textField('lateFeeFlatAmount')} disabled={!canEdit} /></label>
          <label>Amount per late day<input inputMode="decimal" value={form.lateFeePerDay} onChange={textField('lateFeePerDay')} disabled={!canEdit} /></label>
          <label>Percentage<input inputMode="decimal" value={form.lateFeePercent} onChange={textField('lateFeePercent')} disabled={!canEdit} /><small>Percent of currently outstanding amount.</small></label>
          <label>Maximum late-fee amount<input inputMode="decimal" value={form.lateFeeMaxAmount} onChange={textField('lateFeeMaxAmount')} placeholder="No cap" disabled={!canEdit} /></label>
        </div>
      </section>

      <section className="surface-panel settings-section"><div className="section-heading section-heading-panel"><div><h2>Payment and approval behavior</h2><p>Set the tenant-wide rules that collection and approval flows read at runtime.</p></div></div>
        <div className="settings-grid">
          <label>Partial payments<select value={form.partialPaymentPolicy} onChange={textField('partialPaymentPolicy')} disabled={!canEdit}>{PARTIAL_PAYMENT_POLICIES.map((policy) => <option key={policy} value={policy}>{enumLabel(policy)}</option>)}</select></label>
          <label>Overpayments<select value={form.overpaymentPolicy} onChange={textField('overpaymentPolicy')} disabled={!canEdit}>{OVERPAYMENT_POLICIES.map((policy) => <option key={policy} value={policy}>{enumLabel(policy)}</option>)}</select></label>
          <label>Minimum partial amount<input inputMode="decimal" value={form.minimumPartialAmount} onChange={textField('minimumPartialAmount')} placeholder="No minimum" disabled={!canEdit} /></label>
          <label>Refund approval threshold<input inputMode="decimal" value={form.refundApprovalThreshold} onChange={textField('refundApprovalThreshold')} placeholder="No threshold" disabled={!canEdit} /></label>
          <label>Waiver approval threshold<input inputMode="decimal" value={form.waiverApprovalThreshold} onChange={textField('waiverApprovalThreshold')} placeholder="No threshold" disabled={!canEdit} /></label>
          <label>Adjustment approval threshold<input inputMode="decimal" value={form.adjustmentApprovalThreshold} onChange={textField('adjustmentApprovalThreshold')} placeholder="No threshold" disabled={!canEdit} /></label>
          <label>Reminder schedule days<input value={form.reminderScheduleDays} onChange={textField('reminderScheduleDays')} placeholder="7, 3, 0, 1" disabled={!canEdit} /><small>Comma-separated days before/after the due date.</small></label>
        </div>
        <div className="settings-checkboxes"><label className="check-label"><input type="checkbox" checked={form.allowAdvancePayment} onChange={(event) => change('allowAdvancePayment', event.target.checked)} disabled={!canEdit} /> Allow advance payments</label><label className="check-label"><input type="checkbox" checked={form.allowNegativeDemand} onChange={(event) => change('allowNegativeDemand', event.target.checked)} disabled={!canEdit} /> Allow a demand to produce a credit balance</label></div>
      </section>
      </>}
      {canEdit && <div className="settings-save-row"><span className="muted">Changes are audited and take effect for new calculations.</span><button className="button button-primary" disabled={busy}><Save size={16} /> {busy ? 'Saving…' : 'Save settings'}</button></div>}
    </form>}
    {!form ? null : <div className="tenant-settings-form settings-extension">
      <form className="surface-panel settings-section" onSubmit={saveBranding}><div className="section-heading section-heading-panel"><div><h2>Organization branding</h2><p>These details appear in the workspace and on issued documents.</p></div><Building2 size={17} /></div>
        {branding && <><div className="settings-grid">
          <label>Organization name<input value={branding.organizationName} onChange={(event) => setBranding({ ...branding, organizationName: event.target.value })} maxLength={180} required disabled={!canEditBranding} /></label>
          <label>Legal name<input value={branding.legalName} onChange={(event) => setBranding({ ...branding, legalName: event.target.value })} maxLength={180} disabled={!canEditBranding} /></label>
          <label>Phone<input value={branding.phone} onChange={(event) => setBranding({ ...branding, phone: event.target.value })} maxLength={40} disabled={!canEditBranding} /></label>
          <label>Email<input type="email" value={branding.email} onChange={(event) => setBranding({ ...branding, email: event.target.value })} maxLength={254} disabled={!canEditBranding} /></label>
          <label>Website<input value={branding.website} onChange={(event) => setBranding({ ...branding, website: event.target.value })} maxLength={254} disabled={!canEditBranding} /></label>
          <label>Logo URL or site path<input value={branding.logoUrl} onChange={(event) => setBranding({ ...branding, logoUrl: event.target.value })} maxLength={500} placeholder="/tenant-brands/organization.svg" disabled={!canEditBranding} /><small>Use a same-site path or an HTTPS image URL.</small></label>
          <label>Landing page title<input value={branding.landingTitle} onChange={(event) => setBranding({ ...branding, landingTitle: event.target.value })} maxLength={180} disabled={!canEditBranding} /></label>
          <label className="settings-wide-field">Landing page description<textarea value={branding.landingDescription} onChange={(event) => setBranding({ ...branding, landingDescription: event.target.value })} maxLength={1000} rows={3} disabled={!canEditBranding} /></label>
          <label>Landing page sign-in label<input value={branding.landingActionLabel} onChange={(event) => setBranding({ ...branding, landingActionLabel: event.target.value })} maxLength={80} disabled={!canEditBranding} /></label>
          <label>Address line 1<input value={branding.addressLine1} onChange={(event) => setBranding({ ...branding, addressLine1: event.target.value })} maxLength={200} disabled={!canEditBranding} /></label>
          <label>Address line 2<input value={branding.addressLine2} onChange={(event) => setBranding({ ...branding, addressLine2: event.target.value })} maxLength={200} disabled={!canEditBranding} /></label>
          <label>City<input value={branding.city} onChange={(event) => setBranding({ ...branding, city: event.target.value })} maxLength={120} disabled={!canEditBranding} /></label>
          <label>State<input value={branding.state} onChange={(event) => setBranding({ ...branding, state: event.target.value })} maxLength={120} disabled={!canEditBranding} /></label>
          <label>Postal code<input value={branding.postalCode} onChange={(event) => setBranding({ ...branding, postalCode: event.target.value })} maxLength={32} disabled={!canEditBranding} /></label>
          <label>Country<input value={branding.country} onChange={(event) => setBranding({ ...branding, country: event.target.value })} maxLength={120} disabled={!canEditBranding} /></label>
          <label>Authorized signatory<input value={branding.authorizedSignatory} onChange={(event) => setBranding({ ...branding, authorizedSignatory: event.target.value })} maxLength={180} disabled={!canEditBranding} /></label>
          <label className="color-setting">Primary color<input type="color" value={branding.primaryColor} onChange={(event) => setBranding({ ...branding, primaryColor: event.target.value })} disabled={!canEditBranding} /></label>
          <label className="color-setting">Accent color<input type="color" value={branding.accentColor} onChange={(event) => setBranding({ ...branding, accentColor: event.target.value })} disabled={!canEditBranding} /></label>
          <label>Receipt footer<textarea value={branding.receiptFooter} onChange={(event) => setBranding({ ...branding, receiptFooter: event.target.value })} maxLength={1000} rows={2} disabled={!canEditBranding} /></label>
          <label>Invoice footer<textarea value={branding.invoiceFooter} onChange={(event) => setBranding({ ...branding, invoiceFooter: event.target.value })} maxLength={1000} rows={2} disabled={!canEditBranding} /></label>
        </div>{canEditBranding && <div className="settings-save-row"><span className="muted">Branding updates are audited.</span><button className="button button-primary" disabled={busy}><Save size={16} /> Save branding</button></div>}</>}
      </form>

      <form className="surface-panel settings-section" onSubmit={saveNumbering}><div className="section-heading section-heading-panel"><div><h2>Document numbering</h2><p>Set sequence formats for documents produced by enabled modules.</p></div><Hash size={17} /></div>
        {numbering && <><div className="settings-grid">
          {hasPayments && <label>Receipt prefix<input value={numbering.receiptPrefix} onChange={(event) => setNumbering({ ...numbering, receiptPrefix: event.target.value })} maxLength={20} required disabled={!canEditNumbering} /></label>}
          {hasPayments && <label>Invoice prefix<input value={numbering.invoicePrefix} onChange={(event) => setNumbering({ ...numbering, invoicePrefix: event.target.value })} maxLength={20} required disabled={!canEditNumbering} /></label>}
          {hasPayments && <label>Payment prefix<input value={numbering.paymentPrefix} onChange={(event) => setNumbering({ ...numbering, paymentPrefix: event.target.value })} maxLength={20} required disabled={!canEditNumbering} /></label>}
          {hasFees && <label>Demand prefix<input value={numbering.demandPrefix} onChange={(event) => setNumbering({ ...numbering, demandPrefix: event.target.value })} maxLength={20} required disabled={!canEditNumbering} /></label>}
          {hasPayments && <label>Refund prefix<input value={numbering.refundPrefix} onChange={(event) => setNumbering({ ...numbering, refundPrefix: event.target.value })} maxLength={20} required disabled={!canEditNumbering} /></label>}
          {hasPayments && <label>Credit note prefix<input value={numbering.creditNotePrefix} onChange={(event) => setNumbering({ ...numbering, creditNotePrefix: event.target.value })} maxLength={20} required disabled={!canEditNumbering} /></label>}
          {hasPayments && <label>Adjustment prefix<input value={numbering.adjustmentPrefix} onChange={(event) => setNumbering({ ...numbering, adjustmentPrefix: event.target.value })} maxLength={20} required disabled={!canEditNumbering} /></label>}
          {hasAdmissions && <label>Application prefix<input value={numbering.applicationPrefix} onChange={(event) => setNumbering({ ...numbering, applicationPrefix: event.target.value })} maxLength={20} required disabled={!canEditNumbering} /></label>}
          {hasAdmissions && <label>Student prefix<input value={numbering.studentPrefix} onChange={(event) => setNumbering({ ...numbering, studentPrefix: event.target.value })} maxLength={20} required disabled={!canEditNumbering} /></label>}
          <label>Number padding<input type="number" min={1} max={12} value={numbering.padding} onChange={(event) => setNumbering({ ...numbering, padding: Number(event.target.value) })} required disabled={!canEditNumbering} /></label>
          <label>Separator<input value={numbering.separator} onChange={(event) => setNumbering({ ...numbering, separator: event.target.value })} maxLength={5} disabled={!canEditNumbering} /></label>
        </div><div className="settings-checkboxes"><label className="check-label"><input type="checkbox" checked={numbering.includeYear} onChange={(event) => setNumbering({ ...numbering, includeYear: event.target.checked })} disabled={!canEditNumbering} /> Include financial year in displayed numbers</label><label className="check-label"><input type="checkbox" checked={numbering.resetAnnually} onChange={(event) => setNumbering({ ...numbering, resetAnnually: event.target.checked })} disabled={!canEditNumbering} /> Reset counters each financial year</label></div><p className="numbering-help">Annual resets require the displayed financial year and begin at the next financial-year boundary. Existing document numbers stay unchanged.</p>{canEditNumbering && <div className="settings-save-row"><span className="muted">Numbering changes are audited.</span><button className="button button-primary" disabled={busy}><Save size={16} /> Save numbering</button></div>}</>}
      </form>
    </div>}
  </main>;
}

function toForm(settings: TenantSettings): SettingsForm {
  return {
    currency: settings.currency, currencySymbol: settings.currencySymbol, currencyMinorUnits: settings.currencyMinorUnits,
    roundingMode: settings.roundingMode, timezone: settings.timezone, locale: settings.locale, dateFormat: settings.dateFormat,
    defaultAcademicYearId: settings.defaultAcademicYearId ?? '', lateFeeMode: settings.lateFeeMode, lateFeeGraceDays: settings.lateFeeGraceDays,
    lateFeeFlatAmount: settings.lateFeeFlatAmount, lateFeePerDay: settings.lateFeePerDay, lateFeePercent: settings.lateFeePercent,
    lateFeePaymentTermDays: settings.lateFeePaymentTermDays,
    lateFeeMaxAmount: settings.lateFeeMaxAmount ?? '', lateFeeFeeTypeId: settings.lateFeeFeeTypeId ?? '',
    partialPaymentPolicy: settings.partialPaymentPolicy, overpaymentPolicy: settings.overpaymentPolicy,
    allowAdvancePayment: settings.allowAdvancePayment, minimumPartialAmount: settings.minimumPartialAmount ?? '',
    refundApprovalThreshold: settings.refundApprovalThreshold ?? '', waiverApprovalThreshold: settings.waiverApprovalThreshold ?? '',
    adjustmentApprovalThreshold: settings.adjustmentApprovalThreshold ?? '', reminderScheduleDays: settings.reminderScheduleDays.join(', '),
    allowNegativeDemand: settings.allowNegativeDemand,
  };
}
function hasPermission(user: SessionUser | null, permission: string): boolean { return Boolean(user?.isPlatformAdmin || user?.permissions.includes(permission)); }
function dateOnly(value: string): string { return value.slice(0, 10); }

function toBrandingForm(value: Record<string, unknown>): BrandingForm {
  const text = (key: keyof BrandingForm, fallback = '') => typeof value[key] === 'string' ? value[key] as string : fallback;
  return { organizationName: text('organizationName'), legalName: text('legalName'), addressLine1: text('addressLine1'), addressLine2: text('addressLine2'), city: text('city'), state: text('state'), postalCode: text('postalCode'), country: text('country'), phone: text('phone'), email: text('email'), website: text('website'), logoUrl: text('logoUrl'), primaryColor: text('primaryColor', '#0F172A'), accentColor: text('accentColor', '#2563EB'), landingTitle: text('landingTitle'), landingDescription: text('landingDescription'), landingActionLabel: text('landingActionLabel'), receiptFooter: text('receiptFooter'), invoiceFooter: text('invoiceFooter'), authorizedSignatory: text('authorizedSignatory') };
}

function toNumberingForm(value: Record<string, unknown>): NumberingForm {
  const text = (key: keyof NumberingForm, fallback: string) => typeof value[key] === 'string' ? value[key] as string : fallback;
  return { receiptPrefix: text('receiptPrefix', 'RCPT'), invoicePrefix: text('invoicePrefix', 'INV'), paymentPrefix: text('paymentPrefix', 'PAY'), demandPrefix: text('demandPrefix', 'DMD'), refundPrefix: text('refundPrefix', 'REF'), creditNotePrefix: text('creditNotePrefix', 'CRN'), adjustmentPrefix: text('adjustmentPrefix', 'ADJ'), applicationPrefix: text('applicationPrefix', 'APP'), studentPrefix: text('studentPrefix', 'STU'), padding: typeof value.padding === 'number' ? value.padding : 6, includeYear: typeof value.includeYear === 'boolean' ? value.includeYear : true, separator: text('separator', '-'), resetAnnually: typeof value.resetAnnually === 'boolean' ? value.resetAnnually : false };
}
