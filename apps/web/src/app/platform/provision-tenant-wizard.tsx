'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { CORE_TENANT_MODULES, PLATFORM_MODULE_LABELS, TENANT_MODULE_DEPENDENCIES, enumLabel } from '@fee/types';
import { createProvisioningIdempotencyKeyManager } from './provisioning-idempotency';

export interface TenantProvisionPayload {
  name: string;
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
  modules: Array<{ moduleKey: string; enabled: boolean }>;
}

interface Props {
  plans: PlanOption[];
  busy: boolean;
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
    organizationType: trimmed(values, 'organizationType'),
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

function getProvisionPayload(form: HTMLFormElement) {
  return buildTenantProvisionPayload(new FormData(form));
}

export default function ProvisionTenantWizard({ plans, busy, onProvision }: Props) {
  const [step, setStep] = useState(0);
  const [planId, setPlanId] = useState('');
  const [modules, setModules] = useState<string[]>([...CORE_TENANT_MODULES]);
  const [validationMessage, setValidationMessage] = useState('');
  const [review, setReview] = useState<TenantProvisionPayload | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const idempotencyKeysRef = useRef<ReturnType<typeof createProvisioningIdempotencyKeyManager> | null>(null);
  if (!idempotencyKeysRef.current) idempotencyKeysRef.current = createProvisioningIdempotencyKeyManager();
  const availablePlans = useMemo(() => plans.filter((plan) => plan.active), [plans]);
  const selectedPlan = availablePlans.find((plan) => plan.id === planId) ?? null;
  const planModules = selectedPlan?.modules.filter(({ enabled, moduleKey }) => enabled && !CORE_TENANT_MODULES.includes(moduleKey as (typeof CORE_TENANT_MODULES)[number])) ?? [];
  const hasCoreModules = Boolean(selectedPlan && CORE_TENANT_MODULES.every((moduleKey) => selectedPlan.modules.some((module) => module.enabled && module.moduleKey === moduleKey)));

  useEffect(() => {
    if (step > 0) headingRef.current?.focus();
  }, [step]);

  function changePlan(nextPlanId: string) {
    setPlanId(nextPlanId);
    setModules([...CORE_TENANT_MODULES]);
    setValidationMessage('');
  }

  function toggleModule(moduleKey: string, checked: boolean) {
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
      setModules([...CORE_TENANT_MODULES]);
      setReview(null);
      setValidationMessage('');
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

  return <form ref={formRef} className="platform-form platform-provision-wizard" onChange={() => idempotencyKeysRef.current?.payloadChanged()} onSubmit={(event) => void submit(event)} aria-busy={busy}>
    <nav aria-label="Tenant provisioning progress" className="provision-step-nav">
      <ol>{STEPS.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined} className={step === index ? 'current' : index < step ? 'complete' : ''}><span className="provision-step-number">{index + 1}</span><span>{label}</span></li>)}</ol>
      <p aria-live="polite" className="provision-step-count">Step {step + 1} of {STEPS.length}: {STEPS[step]}</p>
    </nav>

    {validationMessage && <div className="notice notice-error" role="alert">{validationMessage}</div>}

    <fieldset data-provision-step="0" hidden={step !== 0}>
      <legend className="provision-step-legend">Organization identity</legend><h3 ref={step === 0 ? headingRef : undefined} tabIndex={-1}>Organization identity</h3>
      <p className="muted">Set the name and category shown across this organization’s workspace. The category is free-form.</p>
      <div className="platform-form-grid">
        <label>Organization name<input name="name" required minLength={2} maxLength={160} autoComplete="organization" /></label>
        <label>Organization type or category<input name="organizationType" required minLength={2} maxLength={80} defaultValue="ORGANIZATION" placeholder="Company, nonprofit, school, club…" /></label>
        <label>Contact email<input name="contactEmail" type="email" maxLength={254} autoComplete="email" /></label>
        <label>Contact phone<input name="contactPhone" maxLength={32} autoComplete="tel" /></label>
        <label>Country code<input name="countryCode" minLength={2} maxLength={2} pattern="[A-Za-z]{2}" placeholder="IN" autoComplete="country" /></label>
      </div>
    </fieldset>

    <fieldset data-provision-step="1" hidden={step !== 1}>
      <legend className="provision-step-legend">Subscription plan and modules</legend><h3 ref={step === 1 ? headingRef : undefined} tabIndex={-1}>Subscription plan and modules</h3>
      <p className="muted">The plan sets available features and billing terms. Only plan-enabled optional modules can be selected.</p>
      <div className="platform-form-grid">
        <label>Subscription plan<select name="planId" required value={planId} onChange={(event) => changePlan(event.currentTarget.value)}><option value="">Choose an active plan</option>{availablePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {plan.currency} {plan.monthlyPrice}/month</option>)}</select></label>
        <label>Billing interval<select name="billingInterval" defaultValue="MONTHLY"><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option><option value="MANUAL">Manual</option></select></label>
      </div>
      <fieldset className="platform-plan-options"><legend>Workspace modules</legend><p className="muted">Core tools are included automatically. Optional workflows may depend on another module.</p>
        {CORE_TENANT_MODULES.map((moduleKey) => <input key={moduleKey} type="hidden" name="enabledModules" value={moduleKey} />)}
        <div className="platform-module-options">
          <div className="platform-core-module-list" aria-label="Required core modules">{CORE_TENANT_MODULES.map((moduleKey) => <span key={moduleKey}>{PLATFORM_MODULE_LABELS[moduleKey]} · Required</span>)}</div>
          {planModules.map(({ moduleKey }) => <label key={moduleKey}><input type="checkbox" name="enabledModules" value={moduleKey} checked={modules.includes(moduleKey)} onChange={(event) => toggleOptionalModule(moduleKey, event.currentTarget.checked)} />{PLATFORM_MODULE_LABELS[moduleKey as keyof typeof PLATFORM_MODULE_LABELS] ?? enumLabel(moduleKey)}</label>)}
          {selectedPlan && planModules.length === 0 && <p className="empty-inline">This plan has no optional modules.</p>}
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
      <p className="muted">The new Tenant Admin receives a single-use email invitation and chooses a password before their first sign-in.</p>
      <div className="platform-form-grid">
        <label>First name<input name="tenantAdminFirstName" required maxLength={120} autoComplete="given-name" /></label>
        <label>Last name<input name="tenantAdminLastName" maxLength={120} autoComplete="family-name" /></label>
        <label>Admin email<input name="tenantAdminEmail" type="email" required maxLength={254} autoComplete="email" /></label>
        <p className="notice wide-field">An invitation will be sent to this email address after the workspace is created. The link expires in 48 hours.</p>
      </div>
    </fieldset>

    <fieldset data-provision-step="4" hidden={step !== 4}>
      <legend className="provision-step-legend">Review before provisioning</legend><h3 ref={step === 4 ? headingRef : undefined} tabIndex={-1}>Review before provisioning</h3>
      <p className="muted">Check the workspace, access, and regional defaults. The subdomain is generated and checked by the platform.</p>
      {review && <dl className="provision-review-list">
        <div><dt>Organization</dt><dd>{review.name} · {review.organizationType}{review.countryCode ? ` · ${review.countryCode}` : ''}</dd></div>
        <div><dt>Contact</dt><dd>{review.contactEmail ?? 'No email'} · {review.contactPhone ?? 'No phone'}</dd></div>
        <div><dt>Plan</dt><dd>{selectedPlan?.name ?? 'No plan selected'} · {enumLabel(review.billingInterval)}</dd></div>
        <div><dt>Modules</dt><dd>{review.enabledModules.map((module) => PLATFORM_MODULE_LABELS[module as keyof typeof PLATFORM_MODULE_LABELS] ?? enumLabel(module)).join(', ')}</dd></div>
        <div><dt>Regional defaults</dt><dd>{review.currency} {review.currencySymbol} · {review.timezone} · {review.locale}</dd></div>
        <div><dt>Initial Tenant Admin</dt><dd>{review.tenantAdminFirstName} {review.tenantAdminLastName ?? ''} · {review.tenantAdminEmail} · Invitation link sent after provisioning</dd></div>
        <div><dt>Workspace address</dt><dd>Generated from the organization name after availability checks</dd></div>
      </dl>}
      <p className="notice">Provisioning creates the workspace, Tenant Admin, and invitation event in one transaction.</p>
    </fieldset>

    <div className="provision-wizard-actions">
      {step > 0 && <button type="button" className="button button-secondary" disabled={busy} onClick={() => goToStep(step - 1)}>Back</button>}
      {step < STEPS.length - 1 ? <button type="button" className="button button-primary" disabled={busy} onClick={() => goToStep(step + 1)}>Continue</button> : <button className="button button-primary" disabled={busy || !hasCoreModules}>{busy ? 'Provisioning…' : 'Provision tenant workspace'}</button>}
    </div>
  </form>;
}
