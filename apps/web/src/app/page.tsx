'use client';
import { formatIndianDate, formatIndianNumber } from '../lib/locale';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, Building2, CheckCircle2, GraduationCap, LockKeyhole, ReceiptText, UsersRound, WalletCards, BarChart3, BellRing, Settings2, ShieldCheck, Landmark, GitBranch, ClipboardList } from 'lucide-react';
import { apiRequest, platformHomeHref } from '../lib/api';
import { sessionMatchesHost, useSession } from '../components/session-provider';
import { useTenant } from '../components/tenant-provider';

interface WorkspaceOverview {
  organization: { name: string; type: string; status: string; subscriptionStatus: string };
  subscription: { plan: string | null; planKey: string | null; status: string; billingInterval: string | null; trialEndsAt: string | null; periodEnd: string | null };
  modules: string[];
  counts: { totalUsers: number; activeUsers: number; branchCount: number; organizationUnitCount: number; visibleMembers: number; openAssignments: number };
  onboarding: Array<{ key: string; label: string; complete: boolean }>;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading } = useSession();
  const tenant = useTenant();
  const currentHostUser = sessionMatchesHost(user, tenant) ? user : null;
  useEffect(() => {
    if (tenant.kind === 'platform' && currentHostUser?.isPlatformAdmin && !currentHostUser.mustChangePassword) router.replace('/platform');
  }, [router, tenant.kind, currentHostUser?.isPlatformAdmin, currentHostUser?.mustChangePassword]);
  if (tenant.kind === 'loading') return <main id="main-content" className="landing-loading" role="status">Finding this workspace…</main>;
  if (tenant.kind === 'error') return <main id="main-content" className="tenant-status-page"><Landmark size={34} /><p className="eyebrow">TENANT WORKSPACE</p><h1>Workspace information is unavailable</h1><p>We could not reach the workspace service. Check your connection and try again.</p><button className="button button-primary" onClick={() => window.location.reload()}>Try again</button></main>;
  if (tenant.kind === 'unknown') return <main id="main-content" className="tenant-status-page"><Landmark size={34} /><p className="eyebrow">TENANT WORKSPACE</p><h1>Workspace not found</h1><p>Check the web address or contact your organization for its workspace link.</p><a className="button button-secondary" href={platformHomeHref()}>Return to platform home</a></main>;
  if (tenant.kind === 'inactive') return <main id="main-content" className="tenant-status-page"><Landmark size={34} /><p className="eyebrow">{tenant.name}</p><h1>Workspace temporarily unavailable</h1><p>This organization workspace is currently inactive. Contact its administrator for help.</p></main>;
  if (tenant.kind === 'platform') {
    if (currentHostUser?.isPlatformAdmin) return <main id="main-content" className="landing-loading" role="status">Opening Super Admin control plane… <Link href="/platform">Open it now</Link></main>;
    if (currentHostUser) return <main id="main-content" className="tenant-status-page"><ShieldCheck size={34} /><p className="eyebrow">PLATFORM ADMINISTRATION</p><h1>Super Admin access required</h1><p>This account cannot access the platform control plane. Sign in with an authorized Super Admin account.</p><Link className="button button-secondary" href="/login">Go to sign in</Link></main>;
    return <PublicLanding />;
  }
  if (loading) return <main id="main-content" className="landing-loading" role="status">Checking your secure workspace…</main>;
  if (tenant.kind === 'tenant') return currentHostUser ? <WorkspaceDashboard /> : <TenantLanding tenant={tenant} />;
  if (!currentHostUser) return <PublicLanding />;
  return <WorkspaceDashboard />;
}

function TenantLanding({ tenant }: { tenant: Extract<ReturnType<typeof useTenant>, { kind: 'tenant' }> }) {
  const { branding } = tenant;
  const organizationName = branding.organizationName || tenant.name;
  const landingTitle = branding.landingTitle?.trim() || 'A clear place for your organization to work.';
  const landingDescription = branding.landingDescription?.trim() || 'Bring your people, locations, groups, and everyday workflows together in one private workspace.';
  const landingActionLabel = branding.landingActionLabel?.trim() || 'Sign in to your workspace';
  const organizationInitial = organizationName.trim().slice(0, 1).toUpperCase() || 'W';
  return <main id="main-content" className="tenant-landing">
    <header className="tenant-public-header">
      <Link className="tenant-public-brand" href="/" aria-label={`${organizationName} home`}>
        {branding.logoUrl ? <img className="tenant-public-logo" src={branding.logoUrl} alt="" /> : <span className="tenant-public-mark" aria-hidden="true">{organizationInitial}</span>}
        <span className="tenant-public-brand-copy"><strong>{organizationName}</strong><small>{tenant.organizationTypeLabel || 'Organization'} workspace</small></span>
      </Link>
      <nav className="tenant-public-nav" aria-label="Workspace navigation">
        <span><LockKeyhole size={14} /> Private workspace</span>
        <Link className="button button-secondary" href="/login">Sign in <ArrowRight size={15} /></Link>
      </nav>
    </header>
    <section className="tenant-welcome" aria-labelledby="tenant-welcome-title">
      <div className="tenant-welcome-copy">
        <p className="tenant-welcome-kicker"><span aria-hidden="true" /> Welcome to {organizationName}</p>
        <h1 id="tenant-welcome-title">{organizationName}</h1>
        <h2>{landingTitle}</h2>
        <p className="tenant-welcome-description">{landingDescription}</p>
        <div className="tenant-welcome-actions">
          <Link className="button button-primary" href="/login">{landingActionLabel} <ArrowRight size={16} /></Link>
          <Link className="tenant-access-link" href="/register">{tenant.allowPublicRegistration ? 'Create an account' : 'Request access'}</Link>
        </div>
        <p className="tenant-welcome-security"><LockKeyhole size={15} /> Your organization controls access to this workspace.</p>
      </div>
      <aside className="tenant-workspace-art" aria-label={`${organizationName} fee collection and analytics preview`}>
        <FeeCollectionPreview organizationName={organizationName} />
      </aside>
    </section>
    <section className="tenant-wasl-section" aria-labelledby="tenant-wasl-title">
      <div className="tenant-wasl-copy">
        <p className="tenant-wasl-kicker">Powered by Wasl</p>
        <h2 id="tenant-wasl-title">One platform. Independent workspaces.</h2>
        <p>Wasl gives organizations a secure foundation for their people, access, branches, and the workflows they choose to use.</p>
        <div className="tenant-wasl-capabilities" aria-label="Wasl platform capabilities"><span>People and access</span><span>Branches and groups</span><span>Flexible workflows</span></div>
      </div>
      <div className="tenant-wasl-lockup" aria-label="Wasl, Connect. Track. Report.">
        <span className="tenant-wasl-mark" aria-hidden="true">و</span>
        <span><strong>Wasl <span lang="ar" dir="rtl">وصل</span></strong><small>Connect. Track. Report.</small></span>
      </div>
    </section>
    <footer className="tenant-public-footer"><span>{organizationName}</span><span>Private organization workspace</span><Link href={platformHomeHref()}>Powered by Wasl</Link></footer>
  </main>;
}

function PublicLanding() {
  const [activeJourneyStep, setActiveJourneyStep] = useState(0);
  const journeySteps = [
    {
      number: '01',
      title: 'Create a workspace',
      summary: 'Set up an organization and its workspace.',
      description: 'A platform administrator configures the organization, workspace address, plan, and enabled modules. Wasl creates a private workspace for its team.',
      icon: Building2,
    },
    {
      number: '02',
      title: 'Set up your team',
      summary: 'Invite people and give them the right access.',
      description: 'Tenant administrators add members, choose roles, and scope access to the branches and groups each person needs.',
      icon: UsersRound,
    },
    {
      number: '03',
      title: 'Run your workflows',
      summary: 'Work with only the modules your organization uses.',
      description: 'Members use the enabled tools for their organization, manage day-to-day work, and review activity in reports.',
      icon: Settings2,
    },
  ];
  const activeStep = journeySteps[activeJourneyStep];
  const ActiveStepIcon = activeStep.icon;

  return <main id="main-content" className="public-landing">
    <header className="platform-landing-header">
      <Link className="platform-landing-logo-link" href="/" aria-label="Wasl (وصل) home"><img className="platform-landing-logo" src="/wasl-logo.svg" alt="Wasl — وصل. Connect. Track. Report." /></Link>
    </header>
    <section className="platform-landing-hero" aria-labelledby="platform-landing-title">
      <div className="platform-landing-copy">
        <p className="platform-landing-eyebrow">WASL · ONE PLATFORM, INDEPENDENT WORKSPACES</p>
        <h1 id="platform-landing-title">Fee Collection, teams and reports in one place.</h1>
        <p className="platform-landing-description">Connect payments, attendance and everyday work in a private workspace shaped around each organization.</p>
        <div className="platform-landing-actions">
          <Link className="button button-primary platform-landing-cta" href="/login">Super Admin sign in <ArrowRight size={16} /></Link>
          <a className="platform-landing-secondary" href="#platform-journey">Explore how Wasl works</a>
        </div>
        <div className="platform-landing-capabilities" aria-label="Platform capabilities"><span>Fee Collection</span><span>Attendance</span><span>Pending Fees</span><span>Receipts</span><span>Reports</span></div>
      </div>
      <FeeCollectionPreview organizationName="Wasl sample workspace" />
    </section>
    <section id="platform-journey" className="platform-journey" aria-labelledby="platform-journey-title">
      <div className="platform-journey-heading">
        <p className="platform-landing-eyebrow">HOW WASL WORKS</p>
        <h2 id="platform-journey-title">From setup to everyday work.</h2>
        <p>Choose a step to see how an organization gets started.</p>
      </div>
      <div className="platform-journey-stepper" data-active-step={activeJourneyStep} role="group" aria-label="Wasl setup steps">
        <div className="platform-journey-track" aria-hidden="true">
          <span className="platform-journey-track-fill" />
        </div>
        {journeySteps.map((step, index) => <button
          key={step.number}
          type="button"
          className={`platform-journey-step${index === activeJourneyStep ? ' is-active' : ''}`}
          aria-pressed={index === activeJourneyStep}
          aria-controls="platform-journey-detail"
          onClick={() => setActiveJourneyStep(index)}
        >
          <span className="platform-journey-number">{step.number}</span>
          <span className="platform-journey-step-title">{step.title}</span>
          <span className="platform-journey-step-summary">{step.summary}</span>
        </button>)}
      </div>
      <article id="platform-journey-detail" className="platform-journey-detail" key={activeStep.number} aria-live="polite" aria-atomic="true">
        <span className="platform-journey-detail-icon"><ActiveStepIcon size={23} aria-hidden="true" /></span>
        <div>
          <p className="platform-journey-detail-label">STEP {activeStep.number}</p>
          <h3>{activeStep.title}</h3>
          <p>{activeStep.description}</p>
        </div>
        <span className="platform-journey-detail-count">{activeStep.number} <span>/ 03</span></span>
      </article>
    </section>
    <footer className="platform-landing-footer"><span>Wasl · وصل</span><span>Connect. Track. Report.</span></footer>
  </main>;
}

function FeeCollectionPreview({ organizationName }: { organizationName: string }) {
  return <div className="fee-preview-scene" role="group" aria-label="Illustrative fee collection receipt and analytics report">
    <div className="fee-preview-report" role="img" aria-label="Fee Collection report: collected ₹1,50,000 this month, with an increasing monthly bar chart">
      <div className="fee-preview-report-heading"><span className="fee-preview-icon"><BarChart3 size={17} /></span><span><small>ANALYTICS REPORT</small><strong>Fee Collection</strong></span><span className="fee-preview-period">This month</span></div>
      <div className="fee-preview-total"><strong>₹1,50,000</strong><span>Collected this month</span></div>
      <div className="fee-preview-chart" aria-hidden="true">
        {[38, 54, 46, 73, 62, 91, 78, 100].map((height, index) => <span key={index} style={{ '--bar-height': `${height}%` } as React.CSSProperties} />)}
      </div>
      <div className="fee-preview-chart-labels"><span>04/10/2026</span><span>11/10/2026</span><span>18/10/2026</span><span>25/10/2026</span></div>
      <div className="fee-preview-report-footer"><span><i /> Fee Collection</span><span><i /> Attendance</span></div>
    </div>
    <div className="fee-preview-receipt" role="img" aria-label="Sample receipt for Aarav Sharma: ₹25,000 collected, ₹1,500 pending, dated 11/10/2026">
      <div className="fee-preview-receipt-brand"><span className="fee-preview-receipt-mark">و</span><span><strong>{organizationName}</strong><small>PAYMENT RECEIPT</small></span><ReceiptText size={18} /></div>
      <div className="fee-preview-receipt-meta"><span>Receipt no.<strong>WSL-2026-00428</strong></span><span>Date<strong>11/10/2026</strong></span></div>
      <div className="fee-preview-payer"><small>RECEIVED FROM</small><strong>Aarav Sharma</strong></div>
      <div className="fee-preview-receipt-line"><span>Monthly fee</span><strong>₹25,000</strong></div>
      <div className="fee-preview-receipt-line"><span>Service charge</span><strong>₹1,500</strong></div>
      <div className="fee-preview-receipt-total"><span>Total fee</span><strong>₹26,500</strong></div>
      <div className="fee-preview-receipt-paid"><span><CheckCircle2 size={15} /> Paid</span><strong>₹25,000</strong></div>
      <div className="fee-preview-pending"><span>Pending Fees</span><strong>₹1,500</strong></div>
      <div className="fee-preview-receipt-note">Sample data · receipt preview</div>
    </div>
    <span className="fee-preview-attendance"><CheckCircle2 size={15} /> Attendance recorded</span>
  </div>;
}

function WorkspaceDashboard() {
  const tenant = useTenant();
  const { user } = useSession();
  const [overview, setOverview] = useState<WorkspaceOverview | null>(null);
  const [issue, setIssue] = useState('');
  useEffect(() => {
    let live = true;
    void apiRequest<WorkspaceOverview>('/organization/dashboard')
      .then((result) => { if (live) setOverview(result); })
      .catch(() => { if (live) setIssue('Workspace overview is unavailable for your role. You can still open the sections you have permission to use.'); });
    return () => { live = false; };
  }, []);

  const enabled = new Set(tenant.kind === 'tenant' ? tenant.enabledModules : []);
  const allAccess = user?.roles.includes('TENANT_ADMIN') || user?.roles.includes('TENANT_OWNER') || false;
  const can = (...keys: string[]) => allAccess || keys.some((key) => user?.permissions.includes(key));
  const workspaces = [
    { module: 'USERS', permission: ['user.read', 'role.read'], href: '/access', title: 'People and access', description: 'Manage organization users, roles, and permissions.', label: 'Manage access', icon: <UsersRound size={20} /> },
    { module: 'BRANCHES', permission: ['branch.read', 'branch.manage'], href: '/organization', title: 'Branches', description: 'Manage locations, branch membership, and organization structure.', label: 'Manage organization', icon: <GitBranch size={20} /> },
    { module: 'ASSIGNMENTS', permission: ['assignment.read', 'assignment.manage'], href: '/organization', title: 'Assignments', description: 'Review work assigned to people across your organization.', label: 'Manage assignments', icon: <ClipboardList size={20} /> },
    { module: 'ADMISSIONS', permission: ['student.read', 'admission.read'], href: '/admissions', title: 'Admissions', description: 'Use the admissions module enabled for this organization.', label: 'Open admissions', icon: <GraduationCap size={20} /> },
    { module: 'FEES', permission: ['fee.catalog.read', 'fee.structure.read', 'invoice.read'], href: '/fee-structures', title: 'Fee operations', description: 'Configure optional fee schedules and organization charges.', label: 'Open fee operations', icon: <ReceiptText size={20} /> },
    { module: 'PAYMENTS', permission: ['payment.read'], href: '/payments', title: 'Payments', description: 'Review payment activity and supported collection workflows.', label: 'Open payments', icon: <WalletCards size={20} /> },
    { module: 'REPORTS', permission: ['report.read'], href: '/reports', title: 'Reports', description: 'Review the reports available to your role and branch scope.', label: 'Open reports', icon: <BarChart3 size={20} /> },
    { module: 'NOTIFICATIONS', permission: ['notification.read', 'notification.manage'], href: '/notifications', title: 'Notifications', description: 'Manage organization notification settings and delivery history.', label: 'Open notifications', icon: <BellRing size={20} /> },
    { module: null, permission: ['tenant.settings.read', 'tenant.settings.update'], href: '/settings', title: 'Organization settings', description: 'Review organization identity, localization, and shared settings.', label: 'Open settings', icon: <Settings2 size={20} /> },
  ].filter((item) => (!item.module || enabled.has(item.module)) && can(...item.permission));

  return <main id="main-content" className="page-content">
    <div className="page-heading dashboard-heading"><div><p className="eyebrow">{overview?.organization.type ?? 'ORGANIZATION'} WORKSPACE</p><h1>Welcome{user?.firstName ? `, ${user.firstName}` : ''}.</h1><p className="muted">A live overview of the organization data available to your role.</p></div><Link className="button button-primary" href={can('user.read', 'role.read') ? '/access' : '/organization'}>Open workspace <ArrowUpRight size={16} /></Link></div>
    {issue && <div className="notice notice-info" role="status">{issue}</div>}
    <section className="metric-grid" aria-label="Organization totals">
      <Metric label="Active members" value={overview?.counts.activeUsers} icon={<UsersRound size={19} />} color="blue" />
      <Metric label="Branches" value={overview?.counts.branchCount} icon={<Building2 size={19} />} color="violet" />
      <Metric label="Departments and groups" value={overview?.counts.organizationUnitCount} icon={<GitBranch size={19} />} color="amber" />
      <Metric label="Open assignments" value={overview?.counts.openAssignments} icon={<ClipboardList size={19} />} color="green" />
    </section>
    <section className="dashboard-subscription-card"><div><p className="eyebrow">SUBSCRIPTION</p><strong>{overview?.subscription.plan ?? 'Plan not assigned'}</strong><span>{overview ? overview.subscription.status.replaceAll('_', ' ').toLowerCase() : 'Loading plan details'}{overview?.subscription.periodEnd ? ` · Renews ${formatIndianDate(new Date(overview.subscription.periodEnd))}` : overview?.subscription.trialEndsAt ? ` · Trial ends ${formatIndianDate(new Date(overview.subscription.trialEndsAt))}` : ''}</span></div><div className="dashboard-module-tags">{(overview?.modules ?? (tenant.kind === 'tenant' ? tenant.enabledModules : [])).map((moduleKey) => <span key={moduleKey}>{moduleKey.replaceAll('_', ' ').toLowerCase()}</span>)}</div></section>
    {overview?.onboarding.length ? <section className="surface-panel dashboard-onboarding"><div className="section-heading"><div><h2>Getting started</h2><p>Recommended steps for setting up your organization workspace.</p></div><CheckCircle2 size={18} /></div><div className="dashboard-onboarding-list">{overview.onboarding.map((task) => <div key={task.key}><span className={task.complete ? 'dashboard-task-complete' : 'dashboard-task-open'}>{task.complete ? '✓' : '•'}</span><span>{task.label}</span><small>{task.complete ? 'Done' : 'Next step'}</small></div>)}</div></section> : null}
    <div className="section-heading"><div><h2>Available workspaces</h2><p>Only features enabled for this organization and your role are shown.</p></div></div>
    <section className="workspace-grid">{workspaces.map((item) => <Workspace key={item.href + item.title} href={item.href} icon={item.icon} title={item.title} description={item.description} label={item.label} />)}</section>
  </main>;
}

function Metric({ label, value, icon, color }: { label: string; value?: number; icon: React.ReactNode; color: string }) {
  return <article className="metric-card"><div className={`metric-icon ${color}`}>{icon}</div><p>{label}</p><strong>{value === undefined ? '—' : formatIndianNumber(value)}</strong><small>{value === undefined ? 'Loading total' : 'In your allowed scope'}</small></article>;
}

function Workspace({ href, icon, title, description, label }: { href: string; icon: React.ReactNode; title: string; description: string; label: string }) {
  return <Link href={href} className="workspace-card"><span className="workspace-icon">{icon}</span><h3>{title}</h3><p>{description}</p><span className="workspace-action">{label}<ArrowUpRight size={15} /></span></Link>;
}
