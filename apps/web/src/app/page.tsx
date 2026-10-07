'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowRight, ArrowUpRight, Building2, CheckCircle2, GraduationCap, Layers3, LockKeyhole, ReceiptText, UsersRound, WalletCards, BarChart3, BellRing, Settings2, ShieldCheck, Landmark, GitBranch, ClipboardList } from 'lucide-react';
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
  return <main id="main-content" className="tenant-landing">
    <header className="landing-header">
      <Link className="landing-brand" href="/" aria-label={`${organizationName} home`}>
        {branding.logoUrl ? <img className="tenant-logo" src={branding.logoUrl} alt="" /> : <span className="brand-mark"><Landmark size={18} /></span>}
        <span>{organizationName}</span>
      </Link>
      <Link className="button button-secondary landing-sign-in" href="/login">Workspace sign in <ArrowRight size={15} /></Link>
    </header>
    <section className="tenant-hero">
      <div className="tenant-hero-copy">
        <p className="eyebrow">{organizationName.toUpperCase()}</p>
        <h1>{branding.landingTitle || `Welcome to ${organizationName}`}</h1>
        <p className="landing-lede">{branding.landingDescription || 'A secure workspace for your team to organize people, locations, and the work your organization manages.'}</p>
        <div className="landing-actions">
          <Link className="button button-primary" href="/login">{branding.landingActionLabel || 'Sign in to your workspace'} <ArrowRight size={16} /></Link>
          <Link className="landing-text-link" href="/register">{tenant.allowPublicRegistration ? 'Create a workspace account' : 'Request access'}</Link>
        </div>
        <p className="landing-security"><LockKeyhole size={15} /> Workspace information is available only to authorized users.</p>
      </div>
      <aside className="tenant-hero-card"><span className="tenant-hero-icon"><WalletCards size={27} /></span><p className="eyebrow">ORGANIZATION WORKSPACE</p><h2>Everything stays connected.</h2><p>Bring your team, locations, and enabled workflows together in one private workspace.</p><div className="tenant-hero-divider" /><span><CheckCircle2 size={16} /> Private to {organizationName}</span></aside>
    </section>
    <footer className="landing-footer"><span>{organizationName}</span><span>Private organization workspace</span><Link href="/login">Sign in</Link></footer>
  </main>;
}

function PublicLanding() {
  return <main id="main-content" className="public-landing">
    <header className="landing-header">
      <Link className="landing-brand" href="/" aria-label="Workspace Platform home"><span className="brand-mark"><WalletCards size={19} /></span><span>Workspace Platform</span></Link>
      <Link className="button button-secondary landing-sign-in" href="/login">Sign in <ArrowRight size={15} /></Link>
    </header>
    <section className="landing-hero">
      <div className="landing-copy">
        <p className="eyebrow">A PLATFORM FOR INDEPENDENT WORKSPACES</p>
        <h1>Bring your organization and its work into one place.</h1>
        <p className="landing-lede">Set up your people, branches, teams, access rules, and the optional workflows your organization needs.</p>
        <div className="landing-actions">
          <Link className="button button-primary" href="/login">Sign in to your workspace <ArrowRight size={16} /></Link>
          <a className="landing-text-link" href="#platform-overview">Explore the platform</a>
        </div>
        <p className="landing-security"><LockKeyhole size={15} /> Every tenant workspace stays private to its authorized team.</p>
      </div>
      <aside className="landing-workflow" aria-label="How a tenant workspace is organized">
        <p className="landing-workflow-label">A CLEAR ORGANIZATION WORKSPACE</p>
        <h2>Connect the people, places, and work.</h2>
        <ol className="landing-steps">
          <li><span className="landing-step-number">01</span><span><strong>Set up your workspace</strong><small>Choose the organization profile and included modules.</small></span><CheckCircle2 size={18} /></li>
          <li><span className="landing-step-number">02</span><span><strong>Invite your team</strong><small>Assign roles and scope access to the right people.</small></span><CheckCircle2 size={18} /></li>
          <li><span className="landing-step-number">03</span><span><strong>Organize work</strong><small>Use branches, departments, groups, and assignments.</small></span><CheckCircle2 size={18} /></li>
          <li><span className="landing-step-number">04</span><span><strong>Add workflows</strong><small>Enable only the modules your plan and organization need.</small></span><CheckCircle2 size={18} /></li>
        </ol>
        <div className="landing-workflow-foot"><ShieldCheck size={16} /><span>Tenant-scoped workspace with auditable financial operations</span></div>
      </aside>
    </section>
    <section className="landing-capabilities" id="platform-overview">
      <div className="landing-section-heading"><p className="eyebrow">ONE CONNECTED PLATFORM</p><h2>Build a workspace around your organization.</h2></div>
      <div className="landing-capability-grid">
        <article><span className="landing-capability-icon"><UsersRound size={19} /></span><h3>Shared organization core</h3><p>Manage members, branches, groups, roles, assignments, and settings from one tenant workspace.</p></article>
        <article><span className="landing-capability-icon"><Layers3 size={19} /></span><h3>Optional modules</h3><p>Enable the workflows and features that fit each organization without changing its tenant structure.</p></article>
        <article><span className="landing-capability-icon"><ShieldCheck size={19} /></span><h3>Scoped access</h3><p>Keep tenant data separated and grant each role only the actions it needs.</p></article>
      </div>
    </section>
    <footer className="landing-footer"><span>Workspace Platform</span><span>One platform, independent workspaces</span><Link href="/login">Sign in</Link></footer>
  </main>;
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
    <section className="dashboard-subscription-card"><div><p className="eyebrow">SUBSCRIPTION</p><strong>{overview?.subscription.plan ?? 'Plan not assigned'}</strong><span>{overview ? overview.subscription.status.replaceAll('_', ' ').toLowerCase() : 'Loading plan details'}{overview?.subscription.periodEnd ? ` · Renews ${new Date(overview.subscription.periodEnd).toLocaleDateString()}` : overview?.subscription.trialEndsAt ? ` · Trial ends ${new Date(overview.subscription.trialEndsAt).toLocaleDateString()}` : ''}</span></div><div className="dashboard-module-tags">{(overview?.modules ?? (tenant.kind === 'tenant' ? tenant.enabledModules : [])).map((moduleKey) => <span key={moduleKey}>{moduleKey.replaceAll('_', ' ').toLowerCase()}</span>)}</div></section>
    {overview?.onboarding.length ? <section className="surface-panel dashboard-onboarding"><div className="section-heading"><div><h2>Getting started</h2><p>Recommended steps for setting up your organization workspace.</p></div><CheckCircle2 size={18} /></div><div className="dashboard-onboarding-list">{overview.onboarding.map((task) => <div key={task.key}><span className={task.complete ? 'dashboard-task-complete' : 'dashboard-task-open'}>{task.complete ? '✓' : '•'}</span><span>{task.label}</span><small>{task.complete ? 'Done' : 'Next step'}</small></div>)}</div></section> : null}
    <div className="section-heading"><div><h2>Available workspaces</h2><p>Only features enabled for this organization and your role are shown.</p></div></div>
    <section className="workspace-grid">{workspaces.map((item) => <Workspace key={item.href + item.title} href={item.href} icon={item.icon} title={item.title} description={item.description} label={item.label} />)}</section>
  </main>;
}

function Metric({ label, value, icon, color }: { label: string; value?: number; icon: React.ReactNode; color: string }) {
  return <article className="metric-card"><div className={`metric-icon ${color}`}>{icon}</div><p>{label}</p><strong>{value === undefined ? '—' : value.toLocaleString()}</strong><small>{value === undefined ? 'Loading total' : 'In your allowed scope'}</small></article>;
}

function Workspace({ href, icon, title, description, label }: { href: string; icon: React.ReactNode; title: string; description: string; label: string }) {
  return <Link href={href} className="workspace-card"><span className="workspace-icon">{icon}</span><h3>{title}</h3><p>{description}</p><span className="workspace-action">{label}<ArrowUpRight size={15} /></span></Link>;
}
