'use client';
import { formatIndianCurrency, formatIndianNumber } from '../../lib/locale';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CORE_TENANT_MODULES, ORGANIZATION_CATEGORIES, ORGANIZATION_CATEGORY_KEYS, PLATFORM_MODULE_LABELS, TENANT_MODULE_DEPENDENCIES, enumLabel, type OrganizationCategoryKey } from '@fee/types';
import { apiRequest } from '../../lib/api';
import { createProvisioningIdempotencyKeyManager } from './provisioning-idempotency';

export interface TenantProvisionPayload {
  name: string;
  slug: string;
  organizationType: string;
  contactEmail: string | null;
  contactPhone: string | null;
  countryCode: string | null;
  enabledModules: string[];
  currency: string;
  currencySymbol: string;
  currencyMinorUnits: number;
  timezone: string;
  locale: string;
  tenantAdminEmail: string;
  tenantAdminFirstName: string;
  tenantAdminLastName: string | null;
  planId: string;
  billingInterval: 'MONTHLY' | 'YEARLY' | 'MANUAL';
}

interface PlanOption {
  id: string;
  key: string;
  name: string;
  monthlyPrice: string;
  currency: string;
  active: boolean;
  trialDays: number;
  modules: Array<{ moduleKey: string; enabled: boolean }>;
  entitlements: Array<{ entitlementKey: string; limitValue: number | null }>;
}

interface Props {
  plans: PlanOption[];
  busy: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onProvision: (payload: TenantProvisionPayload, idempotencyKey: string) => Promise<boolean>;
}

const STEPS = ['Organization', 'Plan and modules', 'Regional settings', 'Tenant Admin', 'Review'];

function trimmed(values: FormData, key: string) {
  return String(values.get(key) ?? '').trim();
}

function optional(values: FormData, key: string) {
  return trimmed(values, key) || null;
}

export function buildTenantProvisionPayload(values: FormData): TenantProvisionPayload {
  return {
    name: trimmed(values, 'name'),
    slug: trimmed(values, 'slug').toLowerCase(),
    organizationType: trimmed(values, 'organizationType') === 'custom' ? trimmed(values, 'customOrganizationType') : trimmed(values, 'organizationType'),
    contactEmail: optional(values, 'contactEmail'),
    contactPhone: optional(values, 'contactPhone'),
    countryCode: optional(values, 'countryCode')?.toUpperCase() ?? null,
    enabledModules: [...new Set(values.getAll('enabledModules').map(String))],
    currency: trimmed(values, 'currency').toUpperCase(),
    currencySymbol: trimmed(values, 'currencySymbol'),
    currencyMinorUnits: Number(trimmed(values, 'currencyMinorUnits')),
    timezone: trimmed(values, 'timezone'),
    locale: trimmed(values, 'locale'),
    tenantAdminEmail: trimmed(values, 'tenantAdminEmail'),
    tenantAdminFirstName: trimmed(values, 'tenantAdminFirstName'),
    tenantAdminLastName: optional(values, 'tenantAdminLastName'),
    planId: trimmed(values, 'planId'),
    billingInterval: trimmed(values, 'billingInterval') as TenantProvisionPayload['billingInterval'],
  };
}

export function slugFromOrganizationName(name: string): string {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63).replace(/-+$/g, '');
}

function tenantDomainSuffix(): string {
  if (typeof window === 'undefined') return 'workspace-domain';
  const platformSubdomain = process.env.NEXT_PUBLIC_PLATFORM_SUBDOMAIN?.trim().toLowerCase() || 'platform';
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  try {
    const apiHost = apiBase ? new URL(apiBase).hostname.toLowerCase() : window.location.hostname.toLowerCase();
    if (apiHost.startsWith(`${platformSubdomain}.`)) return apiHost.slice(platformSubdomain.length + 1);
    if (apiHost === 'localhost' || apiHost.endsWith('.localhost')) return 'localhost';
    return apiHost;
  } catch {
    return window.location.hostname.endsWith('.localhost') ? 'localhost' : window.location.hostname;
  }
}

function getProvisionPayload(form: HTMLFormElement) {
  return buildTenantProvisionPayload(new FormData(form));
}

export default function ProvisionTenantWizard({ plans, busy, onProvision, onDirtyChange }: Props) {
  const [step, setStep] = useState(0);
  const [planId, setPlanId] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [categoryKey, setCategoryKey] = useState<OrganizationCategoryKey | 'custom'>('other_organisation');
  const [customCategory, setCustomCategory] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [slugStatus, setSlugStatus] = useState<'idle' | 'invalid' | 'checking' | 'available' | 'taken' | 'reserved' | 'error'>('idle');
  const [slugRetry, setSlugRetry] = useState(0);
  const [modules, setModules] = useState<string[]>([...CORE_TENANT_MODULES]);
  const [modulesTouched, setModulesTouched] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');
  const [review, setReview] = useState<TenantProvisionPayload | null>(null);
  const [dirty, setDirty] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const idempotencyKeysRef = useRef<ReturnType<typeof createProvisioningIdempotencyKeyManager> | null>(null);
  if (!idempotencyKeysRef.current) idempotencyKeysRef.current = createProvisioningIdempotencyKeyManager();
  const availablePlans = useMemo(() => plans.filter((plan) => plan.active), [plans]);
  const selectedPlan = availablePlans.find((plan) => plan.id === planId) ?? null;
  const selectedCategory = ORGANIZATION_CATEGORIES.find((category) => category.key === categoryKey) ?? ORGANIZATION_CATEGORIES[ORGANIZATION_CATEGORIES.length - 1]!;
  const categoryDisplayName = categoryKey === 'custom' ? customCategory.trim() || 'Custom organisation' : selectedCategory.label;
  const planModules = selectedPlan?.modules.filter(({ enabled, moduleKey }) => enabled && !CORE_TENANT_MODULES.includes(moduleKey as (typeof CORE_TENANT_MODULES)[number])) ?? [];
  const categorySuggestedModules: readonly string[] = selectedCategory.suggestedModules;
  const categorySuggestedModuleSet = new Set(categorySuggestedModules);
  const planSuggestedModules = planModules.filter(({ moduleKey }) => categorySuggestedModuleSet.has(moduleKey));
  const otherPlanModules = planModules.filter(({ moduleKey }) => !categorySuggestedModuleSet.has(moduleKey));
  const unavailableSuggestions = categorySuggestedModules.filter((moduleKey) => !planModules.some((module) => module.moduleKey === moduleKey));
  const hasCoreModules = Boolean(selectedPlan && CORE_TENANT_MODULES.every((moduleKey) => selectedPlan.modules.some((module) => module.enabled && module.moduleKey === moduleKey)));
  const domainSuffix = tenantDomainSuffix();

  useEffect(() => {
    if (slug.length < 2 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug) || slug.length > 63) {
      setSlugStatus(slug ? 'invalid' : 'idle');
      return;
    }
    let current = true;
    setSlugStatus('checking');
    const timeout = window.setTimeout(() => {
      void apiRequest<{ slug: string; available: boolean; reason: 'reserved' | 'in_use' | null }>(`/platform/tenants/slug-availability?slug=${encodeURIComponent(slug)}`)
        .then((result) => { if (current && result.slug === slug) setSlugStatus(result.available ? 'available' : result.reason === 'reserved' ? 'reserved' : 'taken'); })
        .catch(() => { if (current) setSlugStatus('error'); });
    }, 350);
    return () => { current = false; window.clearTimeout(timeout); };
  }, [slug, slugRetry]);

  useEffect(() => {
    if (step > 0) headingRef.current?.focus();
  }, [step]);

  function changePlan(nextPlanId: string) {
    setPlanId(nextPlanId);
    const nextPlan = availablePlans.find((plan) => plan.id === nextPlanId);
    const allowed = new Set(nextPlan?.modules.filter((module) => module.enabled).map((module) => module.moduleKey) ?? []);
    const preserved = modules.filter((moduleKey) => !CORE_TENANT_MODULES.includes(moduleKey as (typeof CORE_TENANT_MODULES)[number]) && allowed.has(moduleKey));
    const suggested = selectedCategory.suggestedModules.filter((moduleKey) => allowed.has(moduleKey));
    setModules([...new Set([...CORE_TENANT_MODULES, ...(modulesTouched ? preserved : suggested)])]);
    setValidationMessage('');
  }

  function changeCategory(nextValue: string) {
    if (nextValue !== 'custom' && !(ORGANIZATION_CATEGORY_KEYS as readonly string[]).includes(nextValue)) return;
    const nextCategory: OrganizationCategoryKey = nextValue === 'custom' ? 'other_organisation' : nextValue as OrganizationCategoryKey;
    setCategoryKey(nextValue === 'custom' ? 'custom' : nextCategory);
    if (!modulesTouched && selectedPlan) {
      const allowed = new Set(selectedPlan.modules.filter((module) => module.enabled).map((module) => module.moduleKey));
      const nextSuggested = ORGANIZATION_CATEGORIES.find((category) => category.key === nextCategory)?.suggestedModules.filter((moduleKey) => allowed.has(moduleKey)) ?? [];
      setModules([...new Set([...CORE_TENANT_MODULES, ...nextSuggested])]);
    }
    if (nextValue !== 'custom') setCustomCategory('');
    setValidationMessage('');
  }

  function setSlugCandidate(value: string) {
    const nextSlug = value.toLowerCase();
    setSlug(nextSlug);
    setSlugStatus(nextSlug.length === 0 ? 'idle' : nextSlug.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(nextSlug) ? 'checking' : 'invalid');
  }

  function toggleModule(moduleKey: string, checked: boolean) {
    setModulesTouched(true);
    setModules((current) => {
      const next = new Set(current);
      if (checked) next.add(moduleKey);
      else next.delete(moduleKey);
      if (checked) {
        for (const dependency of TENANT_MODULE_DEPENDENCIES[moduleKey] ?? []) next.add(dependency);
      } else {
        for (const [dependent, dependencies] of Object.entries(TENANT_MODULE_DEPENDENCIES)) {
          if (dependencies.includes(moduleKey)) next.delete(dependent);
        }
      }
      return [...next];
    });
  }

  function goToStep(nextStep: number) {
    if (nextStep < step) {
      setValidationMessage('');
      setStep(nextStep);
      return;
    }
    const form = formRef.current;
    const section = form?.querySelector<HTMLElement>(`[data-provision-step="${step}"]`);
    const invalid = section?.querySelector<HTMLInputElement | HTMLSelectElement>('input:invalid, select:invalid, textarea:invalid');
    if (invalid) {
      invalid.reportValidity();
      invalid.focus();
      return;
    }
    if (step === 0 && slugStatus !== 'available') {
      setValidationMessage(slugStatus === 'taken' || slugStatus === 'reserved' ? 'Choose a workspace address that is available.' : slugStatus === 'error' ? 'Workspace address availability could not be checked. Retry the check before continuing.' : 'Wait for the workspace address availability check to finish.');
      return;
    }
    if (step === 1 && !hasCoreModules) {
      setValidationMessage('Choose an active plan that includes every required core workspace module.');
      return;
    }
    setValidationMessage('');
    if (nextStep === STEPS.length - 1 && form) setReview(getProvisionPayload(form));
    setStep(nextStep);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formRef.current) return;
    const payload = getProvisionPayload(formRef.current);
    const idempotencyKey = idempotencyKeysRef.current!.forAttempt();
    const success = await onProvision(payload, idempotencyKey);
    if (success) {
      idempotencyKeysRef.current!.clear();
      formRef.current.reset();
      setStep(0);
      setPlanId('');
      setOrganizationName('');
      setCategoryKey('other_organisation');
      setCustomCategory('');
      setSlugCandidate('');
      setSlugManuallyEdited(false);
      setModulesTouched(false);
      setModules([...CORE_TENANT_MODULES]);
      setReview(null);
      setValidationMessage('');
      setDirty(false);
      onDirtyChange?.(false);
      window.dispatchEvent(new CustomEvent('wasl:provision-dirty', { detail: false }));
    }
  }

  function toggleOptionalModule(moduleKey: string, checked: boolean) {
    const prerequisites = (TENANT_MODULE_DEPENDENCIES[moduleKey] ?? []).every((dependency) => modules.includes(dependency) || planModules.some(({ moduleKey: key }) => key === dependency));
    if (checked && !prerequisites) {
      setValidationMessage(`This module requires: ${(TENANT_MODULE_DEPENDENCIES[moduleKey] ?? []).join(', ')}. Enable the required module first.`);
      return;
    }
    toggleModule(moduleKey, checked);
    setValidationMessage('');
  }

  useEffect(() => {
    if (!dirty) return;
    const confirmExit = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', confirmExit);
    return () => window.removeEventListener('beforeunload', confirmExit);
  }, [dirty]);

  function markDirty() {
    setDirty(true);
    onDirtyChange?.(true);
    window.dispatchEvent(new CustomEvent('wasl:provision-dirty', { detail: true }));
  }

  return <form ref={formRef} className="platform-form platform-provision-wizard" onChange={() => { idempotencyKeysRef.current?.payloadChanged(); markDirty(); }} onSubmit={(event) => void submit(event)} aria-busy={busy}>
    <nav aria-label="Tenant provisioning progress" className="provision-step-nav">
      <ol>{STEPS.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={step === index ? 'current' : index < step ? 'complete' : ''}><button type="button" className="provision-step-jump" disabled={index >= step || busy} onClick={() => goToStep(index)} aria-label={index < step ? `Return to ${label}` : `${label}${index === step ? ', current step' : ', upcoming step'}`}><span className="provision-step-number">{index + 1}</span><span>{label}</span></button></li>)}</ol>
      <p aria-live="polite" className="provision-step-count">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
    </nav>

    {validationMessage && <div className="notice notice-error" role="alert">{validationMessage}</div>}

    <fieldset data-provision-step="0" hidden={step !== 0}>
      <legend className="provision-step-legend">Organization identity</legend><h3 ref={step === 0 ? headingRef : undefined} tabIndex={-1}>Organisation identity</h3>
      <p className="muted">Set the organisation name, category, contact details, and workspace address.</p>
      <div className="platform-form-grid">
        <label><span className="form-label-text">Organisation name <span className="field-required">· Required</span></span><input name="name" required minLength={2} maxLength={160} autoComplete="organization" value={organizationName} onChange={(event) => { const nextName = event.currentTarget.value; setOrganizationName(nextName); if (!slugManuallyEdited) setSlugCandidate(slugFromOrganizationName(nextName)); }} /></label>
        <label><span className="form-label-text">Organisation category <span className="field-required">· Required</span></span><select name="organizationType" required value={categoryKey} onChange={(event) => changeCategory(event.currentTarget.value)}>{ORGANIZATION_CATEGORIES.map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}<option value="custom">Custom category</option></select></label>
        {categoryKey === 'custom' && <label><span className="form-label-text">Category name <span className="field-required">· Required</span></span><input name="customOrganizationType" required minLength={2} maxLength={80} value={customCategory} onChange={(event) => setCustomCategory(event.currentTarget.value)} placeholder="For example, Community Centre" /></label>}
        <label><span className="form-label-text">Contact email <span className="field-optional">· Optional</span></span><input name="contactEmail" type="email" maxLength={254} autoComplete="email" /></label>
        <label><span className="form-label-text">Contact phone <span className="field-optional">· Optional</span></span><input name="contactPhone" maxLength={32} autoComplete="tel" /></label>
        <label><span className="form-label-text">Country code <span className="field-optional">· Optional</span></span><input name="countryCode" minLength={2} maxLength={2} pattern="[A-Za-z]{2}" placeholder="IN" autoComplete="country" /></label>
        <label className="provision-slug-field"><span className="form-label-text">Workspace address <span className="field-required">· Required</span></span><span className="provision-slug-control"><input name="slug" required minLength={2} maxLength={63} pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={slug} onChange={(event) => { setSlugManuallyEdited(true); setSlugCandidate(event.currentTarget.value); }} aria-describedby="provision-slug-hint provision-slug-status" /><span>.{domainSuffix}</span></span><small id="provision-slug-hint">Generated from the organisation name. Editing it keeps your chosen address when the name changes.</small><span id="provision-slug-status" className={`provision-slug-status ${slugStatus}`} role="status" aria-live="polite">{slugStatus === 'checking' ? 'Checking availability…' : slugStatus === 'available' ? 'Address available' : slugStatus === 'taken' ? 'Address already in use' : slugStatus === 'reserved' ? 'Address reserved by the platform' : slugStatus === 'invalid' ? 'Use 2–63 lowercase letters, numbers, or internal hyphens' : slugStatus === 'error' ? <>Could not check availability. <button type="button" className="text-button" onClick={() => setSlugRetry((retry) => retry + 1)}>Retry</button></> : 'Enter at least two characters to check this address.'}</span></label>
      </div>
      <section className="provision-category-summary" aria-live="polite"><div><p className="eyebrow">CATEGORY CONFIGURATION</p><h4>{categoryDisplayName}</h4><p>{selectedCategory.description}</p></div><dl><div><dt>People</dt><dd>{selectedCategory.peopleLabel}</dd></div><div><dt>Groups</dt><dd>{selectedCategory.groupLabel}</dd></div></dl><small>Suggestions use Wasl features available today. Your selected plan determines which optional modules can be enabled. Custom categories start with general-purpose workspace guidance.</small></section>
    </fieldset>

    <fieldset data-provision-step="1" hidden={step !== 1}>
      <legend className="provision-step-legend">Subscription plan and modules</legend><h3 ref={step === 1 ? headingRef : undefined} tabIndex={-1}>Subscription plan and modules</h3>
      <p className="muted">The plan controls optional workflows, trial duration, and usage limits. Only included modules can be enabled.</p>
      <div className="platform-form-grid">
        <label><span className="form-label-text">Subscription plan <span className="field-required">· Required</span></span><select name="planId" required value={planId} onChange={(event) => changePlan(event.currentTarget.value)}><option value="">Choose an active plan</option>{availablePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {formatIndianCurrency(plan.monthlyPrice, plan.currency)}/month</option>)}</select></label>
        <label>Billing interval<select name="billingInterval" defaultValue="MONTHLY"><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option><option value="MANUAL">Manual</option></select></label>
      </div>
      {selectedPlan && <section className="provision-plan-terms" aria-label="Selected plan trial and usage limits"><div><small>Trial duration</small><strong>{selectedPlan.trialDays} days</strong></div><div><small>Usage limits</small><strong>{selectedPlan.entitlements.length ? selectedPlan.entitlements.map(({ entitlementKey, limitValue }) => `${enumLabel(entitlementKey)} ${limitValue === null ? 'unlimited' : formatIndianNumber(limitValue)}`).join(' · ') : 'No numeric limits'}</strong></div></section>}
      <fieldset className="platform-plan-options"><legend>Workspace modules</legend><p className="muted">Core tools are included automatically. Optional workflows may depend on another module.</p>
        {CORE_TENANT_MODULES.map((moduleKey) => <input key={moduleKey} type="hidden" name="enabledModules" value={moduleKey} />)}
        <div className="platform-module-options">
          <div className="platform-core-module-list" aria-label="Required core modules">{CORE_TENANT_MODULES.map((moduleKey) => <span key={moduleKey}>{PLATFORM_MODULE_LABELS[moduleKey]} · Required</span>)}</div>
          {categorySuggestedModules.length > 0 && <div className="provision-module-suggestions"><strong>Suggested for {selectedCategory.label}</strong><div>{planSuggestedModules.map(({ moduleKey }) => <label key={moduleKey}><input type="checkbox" name="enabledModules" value={moduleKey} checked={modules.includes(moduleKey)} onChange={(event) => toggleOptionalModule(moduleKey, event.currentTarget.checked)} />{PLATFORM_MODULE_LABELS[moduleKey as keyof typeof PLATFORM_MODULE_LABELS] ?? enumLabel(moduleKey)} <small>Included</small></label>)}{unavailableSuggestions.map((moduleKey) => <span key={moduleKey} className="provision-module-unavailable">{PLATFORM_MODULE_LABELS[moduleKey as keyof typeof PLATFORM_MODULE_LABELS] ?? enumLabel(moduleKey)} <small>Not in this plan</small></span>)}</div></div>}
          {otherPlanModules.length > 0 && <div className="provision-module-suggestions"><strong>Other optional modules in this plan</strong><div>{otherPlanModules.map(({ moduleKey }) => <label key={moduleKey}><input type="checkbox" name="enabledModules" value={moduleKey} checked={modules.includes(moduleKey)} onChange={(event) => toggleOptionalModule(moduleKey, event.currentTarget.checked)} />{PLATFORM_MODULE_LABELS[moduleKey as keyof typeof PLATFORM_MODULE_LABELS] ?? enumLabel(moduleKey)} <small>Included</small></label>)}</div></div>}
          {!selectedPlan && <p className="empty-inline">Choose a plan to see which suggested and optional modules are included.</p>}
          {selectedPlan && planModules.length === 0 && <p className="empty-inline">This plan has no optional modules. Suggested modules shown above are unavailable on this plan.</p>}
        </div>
      </fieldset>
      {selectedPlan && !hasCoreModules && <div className="notice notice-error" role="alert">This plan is missing a required core workspace module. Update the plan before provisioning.</div>}
      {!availablePlans.length && <div className="notice notice-error" role="alert">No active plans are available. Create or activate a plan before provisioning a tenant.</div>}
    </fieldset>

    <fieldset data-provision-step="2" hidden={step !== 2}>
      <legend className="provision-step-legend">Regional and billing defaults</legend><h3 ref={step === 2 ? headingRef : undefined} tabIndex={-1}>Regional and billing defaults</h3>
      <p className="muted">These defaults configure the organization workspace. They can be changed later in its settings.</p>
      <div className="platform-form-grid">
        <label>Currency code<input name="currency" required defaultValue="INR" minLength={3} maxLength={3} pattern="[A-Za-z]{3}" autoCapitalize="characters" /></label>
        <label>Currency symbol<input name="currencySymbol" required defaultValue="₹" maxLength={8} /></label>
        <label>Minor currency units<input name="currencyMinorUnits" type="number" required defaultValue={2} min={0} max={4} step={1} /></label>
        <label>Time zone<input name="timezone" required defaultValue="Asia/Kolkata" maxLength={100} /></label>
        <label>Locale<input name="locale" required defaultValue="en-IN" maxLength={32} /></label>
      </div>
    </fieldset>

    <fieldset data-provision-step="3" hidden={step !== 3}>
      <legend className="provision-step-legend">Initial Tenant Admin</legend><h3 ref={step === 3 ? headingRef : undefined} tabIndex={-1}>Initial Tenant Admin</h3>
      <p className="muted">The Tenant Admin receives a single-use email invitation and chooses a password before their first sign-in.</p>
      <div className="platform-form-grid">
        <label>First name<input name="tenantAdminFirstName" required maxLength={120} autoComplete="given-name" /></label>
        <label>Last name<input name="tenantAdminLastName" maxLength={120} autoComplete="family-name" /></label>
        <label>Admin email<input name="tenantAdminEmail" type="email" required maxLength={254} autoComplete="email" /></label>
        <p className="notice wide-field">An invitation is queued after the workspace is created. The single-use link expires in 48 hours. Do not enter a password here.</p>
      </div>
    </fieldset>

    <fieldset data-provision-step="4" hidden={step !== 4}>
      <legend className="provision-step-legend">Review before provisioning</legend><h3 ref={step === 4 ? headingRef : undefined} tabIndex={-1}>Review before provisioning</h3>
      <p className="muted">Review the organisation, selected category, workspace address, plan access, and initial administrator.</p>
      {review && <dl className="provision-review-list">
        <div><dt>Organisation</dt><dd>{review.name} · {categoryDisplayName} · {selectedCategory.peopleLabel} / {selectedCategory.groupLabel}{review.countryCode ? ` · ${review.countryCode}` : ''}</dd></div>
        <div><dt>Contact</dt><dd>{review.contactEmail ?? 'No email'} · {review.contactPhone ?? 'No phone'}</dd></div>
        <div><dt>Workspace URL</dt><dd>{review.slug}.{domainSuffix}</dd></div>
        <div><dt>Subscription</dt><dd>{selectedPlan?.name ?? 'No plan selected'} · {enumLabel(review.billingInterval)} · {selectedPlan?.trialDays ?? 0} trial days</dd></div>
        <div><dt>Enabled modules</dt><dd>{review.enabledModules.map((module) => PLATFORM_MODULE_LABELS[module as keyof typeof PLATFORM_MODULE_LABELS] ?? enumLabel(module)).join(', ')}</dd></div>
        <div><dt>Plan limits</dt><dd>{selectedPlan?.entitlements.map(({ entitlementKey, limitValue }) => `${enumLabel(entitlementKey)}: ${limitValue === null ? 'Unlimited' : formatIndianNumber(limitValue)}`).join(' · ') || 'No numeric limits'}</dd></div>
        <div><dt>Regional defaults</dt><dd>{review.currency} {review.currencySymbol} · {review.timezone} · {review.locale}</dd></div>
        <div><dt>Initial Tenant Admin</dt><dd>{review.tenantAdminFirstName} {review.tenantAdminLastName ?? ''} · {review.tenantAdminEmail} · Invitation queued after provisioning; link expires in 48 hours</dd></div>
      </dl>}
      <p className="notice">Provisioning creates the workspace, Tenant Admin, and invitation event in one transaction.</p>
    </fieldset>

    <div className="provision-wizard-actions">
      {step > 0 && <button type="button" className="button button-secondary" disabled={busy} onClick={() => goToStep(step - 1)}>Back</button>}
      {step < STEPS.length - 1 ? <button type="button" className="button button-primary" disabled={busy} onClick={() => goToStep(step + 1)}>Continue</button> : <button className="button button-primary" disabled={busy || !hasCoreModules || slugStatus !== 'available'}>{busy ? 'Provisioning…' : 'Provision tenant workspace'}</button>}
    </div>
  </form>;
}
