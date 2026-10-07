'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, Building2, CheckCircle2, GraduationCap, LockKeyhole, ReceiptText, UsersRound, WalletCards, SlidersHorizontal, FileText, BarChart3, Scale, BellRing, CalendarClock, Settings2, ShieldCheck, School, Landmark } from 'lucide-react';
import { apiRequest, platformHomeHref } from '../lib/api';
import { useSession } from '../components/session-provider';
import { useTenant } from '../components/tenant-provider';

interface PageResult { items: unknown[]; pagination: { total: number } }

export default function DashboardPage() {
  const { user, loading } = useSession();
  const tenant = useTenant();
  if (tenant.kind === 'loading') return <main id="main-content" className="landing-loading" role="status">Finding this workspace…</main>;
  if (tenant.kind === 'error') return <main id="main-content" className="tenant-status-page"><Landmark size={34} /><p className="eyebrow">INSTITUTION WORKSPACE</p><h1>Workspace information is unavailable</h1><p>We could not reach the workspace service. Check your connection and try again.</p><button className="button button-primary" onClick={() => window.location.reload()}>Try again</button></main>;
  if (tenant.kind === 'unknown') return <main id="main-content" className="tenant-status-page"><Landmark size={34} /><p className="eyebrow">INSTITUTION WORKSPACE</p><h1>Workspace not found</h1><p>Check the web address or contact your institution for its workspace link.</p><a className="button button-secondary" href={platformHomeHref()}>Return to platform home</a></main>;
  if (tenant.kind === 'inactive') return <main id="main-content" className="tenant-status-page"><Landmark size={34} /><p className="eyebrow">{tenant.name}</p><h1>Workspace temporarily unavailable</h1><p>This institution workspace is currently inactive. Contact the institution administrator for help.</p></main>;
  if (loading) return <main id="main-content" className="landing-loading" role="status">Checking your secure workspace…</main>;
  if (tenant.kind === 'tenant') return user ? <WorkspaceDashboard /> : <TenantLanding tenant={tenant} />;
  if (!user) return <PublicLanding />;
  return <WorkspaceDashboard />;
}

function TenantLanding({ tenant }: { tenant: Extract<ReturnType<typeof useTenant>, { kind: 'tenant' }> }) {
  const { branding } = tenant;
  const organizationName = branding.organizationName || tenant.name;
  return <main id="main-content" className="tenant-landing">
    <header className="landing-header">
      <Link className="landing-brand" href="/" aria-label={`${organizationName} home`}>
        {branding.logoUrl ? <img className="tenant-logo" src={branding.logoUrl} alt="" /> : <span className="brand-mark"><Landmark size={18} /></span>}
        <span>{organizationName}</span>
      </Link>
      <Link className="button button-secondary landing-sign-in" href="/login">Staff sign in <ArrowRight size={15} /></Link>
    </header>
    <section className="tenant-hero">
      <div className="tenant-hero-copy">
        <p className="eyebrow">{organizationName.toUpperCase()}</p>
        <h1>{branding.landingTitle || `Welcome to ${organizationName}`}</h1>
        <p className="landing-lede">{branding.landingDescription || 'A clear and secure place for your institution to manage fee schedules, student demands, and payments.'}</p>
        <Link className="button button-primary" href="/login">{branding.landingActionLabel || 'Sign in to your workspace'} <ArrowRight size={16} /></Link>
        <p className="landing-security"><LockKeyhole size={15} /> Financial information is available only to authorized users.</p>
      </div>
      <aside className="tenant-hero-card"><span className="tenant-hero-icon"><WalletCards size={27} /></span><p className="eyebrow">FEE COLLECTION WORKSPACE</p><h2>Everything stays connected.</h2><p>Review configured fees, follow collections, and keep a clear record of each financial change.</p><div className="tenant-hero-divider" /><span><CheckCircle2 size={16} /> Private to {organizationName}</span></aside>
    </section>
    <footer className="landing-footer"><span>{organizationName}</span><span>Secure fee operations</span><Link href="/login">Staff sign in</Link></footer>
  </main>;
}

function PublicLanding() {
  return <main id="main-content" className="public-landing">
    <header className="landing-header">
      <Link className="landing-brand" href="/" aria-label="Fee Platform home"><span className="brand-mark"><WalletCards size={19} /></span><span>Fee Platform</span></Link>
      <Link className="button button-secondary landing-sign-in" href="/login">Institution sign in <ArrowRight size={15} /></Link>
    </header>
    <section className="landing-hero">
      <div className="landing-copy">
        <p className="eyebrow">FEE OPERATIONS FOR INSTITUTIONS</p>
        <h1>Know what is due, what is paid, and why.</h1>
        <p className="landing-lede">Manage configurable fee schedules, student demands, payer shares, payments, and corrections in one secure institution workspace.</p>
        <div className="landing-actions">
          <Link className="button button-primary" href="/login">Sign in to your workspace <ArrowRight size={16} /></Link>
          <a className="landing-text-link" href="#platform-overview">Explore the platform</a>
        </div>
        <p className="landing-security"><LockKeyhole size={15} /> Institution data stays private to its authorized team.</p>
      </div>
      <aside className="landing-workflow" aria-label="How the fee workspace is organized">
        <p className="landing-workflow-label">A CLEAR FINANCIAL RECORD</p>
        <h2>Every charge, traceable end to end.</h2>
        <ol className="landing-steps">
          <li><span className="landing-step-number">01</span><span><strong>Configure</strong><small>Set dated fee structures and reusable rules.</small></span><CheckCircle2 size={18} /></li>
          <li><span className="landing-step-number">02</span><span><strong>Assign and demand</strong><small>Keep each issued amount explainable.</small></span><CheckCircle2 size={18} /></li>
          <li><span className="landing-step-number">03</span><span><strong>Collect and allocate</strong><small>Track payments against responsible shares.</small></span><CheckCircle2 size={18} /></li>
          <li><span className="landing-step-number">04</span><span><strong>Review and reconcile</strong><small>Keep adjustments and audit history visible.</small></span><CheckCircle2 size={18} /></li>
        </ol>
        <div className="landing-workflow-foot"><ShieldCheck size={16} /><span>Tenant-scoped workspace with auditable financial operations</span></div>
      </aside>
    </section>
    <section className="landing-capabilities" id="platform-overview">
      <div className="landing-section-heading"><p className="eyebrow">ONE CONNECTED WORKSPACE</p><h2>Designed for the whole fee lifecycle.</h2></div>
      <div className="landing-capability-grid">
        <article><span className="landing-capability-icon"><ReceiptText size={19} /></span><h3>Flexible fee setup</h3><p>Organize fee types, schedules, installments, and eligibility rules for each institution.</p></article>
        <article><span className="landing-capability-icon"><WalletCards size={19} /></span><h3>Clear collections</h3><p>Connect demands, payer responsibilities, payment allocations, receipts, and refunds.</p></article>
        <article><span className="landing-capability-icon"><ShieldCheck size={19} /></span><h3>Controlled access</h3><p>Keep institution workspaces separated and grant staff only the access their roles require.</p></article>
      </div>
    </section>
    <footer className="landing-footer"><span>Fee Platform</span><span>Secure fee operations for institutions</span><Link href="/login">Sign in</Link></footer>
  </main>;
}

function WorkspaceDashboard() {
  const [counts, setCounts] = useState<{ students: number; admissions: number; categories: number; structures: number } | null>(null);
  const [issue, setIssue] = useState('');
  useEffect(() => {
    let live = true;
    void Promise.all([
      apiRequest<PageResult>('/students?pageSize=1'),
      apiRequest<PageResult>('/admissions?pageSize=1'),
      apiRequest<PageResult>('/fee-categories?pageSize=1'),
      apiRequest<PageResult>('/fee-structures?pageSize=1'),
    ]).then(([students, admissions, categories, structures]) => {
      if (live) setCounts({ students: students.pagination.total, admissions: admissions.pagination.total, categories: categories.pagination.total, structures: structures.pagination.total });
    }).catch(() => { if (live) setIssue('Some overview data is unavailable for your role. Open a workspace section to continue.'); });
    return () => { live = false; };
  }, []);

  const metrics = [
    { label: 'Students', value: counts?.students, icon: UsersRound, color: 'blue' },
    { label: 'Admission applications', value: counts?.admissions, icon: GraduationCap, color: 'violet' },
    { label: 'Fee categories', value: counts?.categories, icon: ReceiptText, color: 'amber' },
    { label: 'Fee structures', value: counts?.structures, icon: WalletCards, color: 'green' },
  ];

  return <main id="main-content" className="page-content">
    <div className="page-heading dashboard-heading"><div><p className="eyebrow">INSTITUTION OVERVIEW</p><h1>Good day. Let’s get things moving.</h1><p className="muted">A clear view of the records your team manages.</p></div><Link className="button button-primary" href="/students">Open students <ArrowUpRight size={16} /></Link></div>
    {issue && <div className="notice notice-info" role="status">{issue}</div>}
    <section className="metric-grid" aria-label="Workspace totals">{metrics.map(({ label, value, icon: Icon, color }) => <article className="metric-card" key={label}><div className={`metric-icon ${color}`}><Icon size={19} /></div><p>{label}</p><strong>{value === undefined ? '—' : value.toLocaleString()}</strong><small>{value === undefined ? 'Loading totals' : 'In this institution'}</small></article>)}</section>
    <div className="section-heading"><div><h2>Workspaces</h2><p>Pick up where your team needs you.</p></div></div>
    <section className="workspace-grid">
      <Workspace href="/students" icon={<UsersRound size={20} />} title="Students" description="Maintain student records, class placement, and family contacts." label="Manage students" />
      <Workspace href="/sponsors" icon={<Building2 size={20} />} title="Sponsors" description="Maintain third-party payers and record sponsor-supported collections." label="Manage sponsors" />
      <Workspace href="/admissions" icon={<GraduationCap size={20} />} title="Admissions" description="Track applications through review and admission decisions." label="Review applications" />
      <Workspace href="/academic" icon={<School size={20} />} title="Academic structure" description="Manage academic years, academic units, and dynamic student groups." label="Configure structure" />
      <Workspace href="/fee-catalog" icon={<ReceiptText size={20} />} title="Fee catalog" description="Configure reusable fee types and their effective versions." label="Configure catalog" />
      <Workspace href="/fee-structures" icon={<WalletCards size={20} />} title="Fee structures" description="Build dated fee schedules for academic groups and programs." label="Manage structures" />
      <Workspace href="/fee-policies" icon={<SlidersHorizontal size={20} />} title="Rules and policies" description="Configure eligibility, scholarships, discounts, waivers, and surcharges." label="Configure rules" />
      <Workspace href="/fee-assignments" icon={<UsersRound size={20} />} title="Assignments" description="Apply a published schedule and calculate student-level fee demands." label="Assign fee schedules" />
      <Workspace href="/fee-demands" icon={<ReceiptText size={20} />} title="Fee demands" description="Review due amounts and the saved calculation for each student." label="Review demands" />
      <Workspace href="/late-fees" icon={<CalendarClock size={20} />} title="Late fees" description="Accrue configured charges as separate, auditable demands." label="Review accruals" />
      <Workspace href="/installments" icon={<ReceiptText size={20} />} title="Installments" description="View configured schedules and current settlement balances." label="View schedules" />
      <Workspace href="/payments" icon={<WalletCards size={20} />} title="Payments" description="Record manual collections, allocate funds, and issue receipts." label="Collect payments" />
      <Workspace href="/credits" icon={<WalletCards size={20} />} title="Credit balances" description="Track overpayments and apply available credit to open demands." label="Apply credit" />
      <Workspace href="/gateways" icon={<ReceiptText size={20} />} title="Payment gateways" description="Securely configure providers, environments, and method routing." label="Configure gateways" />
      <Workspace href="/refunds" icon={<ReceiptText size={20} />} title="Refunds" description="Review, approve, and process refunds with demand reversals." label="Manage refunds" />
      <Workspace href="/invoices" icon={<FileText size={20} />} title="Invoices" description="Issue immutable billing documents from fee demands and track settlement." label="Review invoices" />
      <Workspace href="/reports" icon={<BarChart3 size={20} />} title="Reports" description="Review tenant-scoped collections, refunds, balances, and fee adjustments." label="Open finance reports" />
      <Workspace href="/reconciliation" icon={<Scale size={20} />} title="Reconciliation" description="Import gateway settlement data, match captured payments, and resolve exceptions." label="Match settlements" />
      <Workspace href="/notifications" icon={<BellRing size={20} />} title="Notifications" description="Configure event templates and review delivery attempts for this institution." label="Manage templates" />
      <Workspace href="/settings" icon={<Settings2 size={20} />} title="Institution settings" description="Set currency, payment rules, locale, and tenant-specific late-fee behavior." label="Configure settings" />
      <Workspace href="/access" icon={<ShieldCheck size={20} />} title="Users and roles" description="Provision staff accounts and review the permissions granted by tenant roles." label="Manage access" />
    </section>
  </main>;
}

function Workspace({ href, icon, title, description, label }: { href: string; icon: React.ReactNode; title: string; description: string; label: string }) {
  return <Link href={href} className="workspace-card"><span className="workspace-icon">{icon}</span><h3>{title}</h3><p>{description}</p><span className="workspace-action">{label}<ArrowUpRight size={15} /></span></Link>;
}
