'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Building2, ChevronDown, GraduationCap, LayoutDashboard, LogOut, ReceiptText, Settings2, UsersRound, WalletCards, SlidersHorizontal, RotateCcw, CircleDollarSign, CalendarClock, ShieldCheck, FileText, BarChart3, Scale, BellRing, BadgePercent, GitBranch, UserRound, type LucideIcon } from 'lucide-react';
import { platformHomeHref, signOut } from '../lib/api';
import { useSession } from './session-provider';
import { useTenant } from './tenant-provider';

type NavigationItem = { href: string; label: string; icon: LucideIcon; requiredModule?: string };

// Keep the preview shell aligned with the production workspace boundary: core
// routes stay generic and each built-in domain adds only its own navigation.
const coreNavigation: NavigationItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/organization', label: 'Branches and groups', icon: GitBranch, requiredModule: 'BRANCHES' },
  { href: '/access', label: 'Users and roles', icon: UsersRound, requiredModule: 'USERS' },
  { href: '/reports', label: 'Reports', icon: BarChart3, requiredModule: 'REPORTS' },
  { href: '/notifications', label: 'Notifications', icon: BellRing, requiredModule: 'NOTIFICATIONS' },
  { href: '/settings', label: 'Organization settings', icon: Settings2 },
  { href: '/audit-logs', label: 'Audit logs', icon: ShieldCheck },
  { href: '/profile', label: 'My profile', icon: UserRound },
];

const moduleNavigation: Record<string, NavigationItem[]> = {
  ADMISSIONS: [
    { href: '/students', label: 'Students', icon: UsersRound },
    { href: '/admissions', label: 'Admissions', icon: GraduationCap },
    { href: '/academic', label: 'Academic structure', icon: Building2 },
  ],
  FEES: [
    { href: '/sponsors', label: 'Sponsors', icon: Building2 },
    { href: '/payer-responsibilities', label: 'Payer responsibilities', icon: CircleDollarSign },
    { href: '/fee-catalog', label: 'Fee catalog', icon: ReceiptText },
    { href: '/fee-structures', label: 'Fee structures', icon: Settings2 },
    { href: '/fee-policies', label: 'Rules and policies', icon: SlidersHorizontal },
    { href: '/benefits', label: 'Benefits and surcharges', icon: BadgePercent },
    { href: '/fee-assignments', label: 'Fee assignments', icon: WalletCards },
    { href: '/fee-demands', label: 'Fee demands', icon: ReceiptText },
    { href: '/late-fees', label: 'Late fees', icon: CalendarClock },
    { href: '/installments', label: 'Installments', icon: CalendarClock },
    { href: '/credits', label: 'Credit balances', icon: CircleDollarSign },
    { href: '/adjustments', label: 'Adjustments', icon: BadgePercent },
    { href: '/invoices', label: 'Invoices', icon: FileText },
  ],
  PAYMENTS: [
    { href: '/payments', label: 'Payments', icon: WalletCards },
    { href: '/gateways', label: 'Payment gateways', icon: ShieldCheck },
    { href: '/refunds', label: 'Refunds', icon: RotateCcw },
    { href: '/receipts', label: 'Receipts', icon: ReceiptText },
    { href: '/reconciliation', label: 'Reconciliation', icon: Scale },
  ],
  PORTAL: [{ href: '/portal', label: 'Payer portal', icon: WalletCards }],
};

const platformNavigation: NavigationItem[] = [
  { href: '/platform', label: 'Platform administration', icon: Building2 },
  { href: '/audit-logs', label: 'Audit logs', icon: ShieldCheck },
  { href: '/profile', label: 'My profile', icon: UserRound },
];

export function ApplicationShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, loading, update } = useSession();
  const tenant = useTenant();
  const path = usePathname();
  const router = useRouter();
  const loginRoute = path === '/login';
  const portalOnly = Boolean(user?.roles.length && user.roles.every((role) => role === 'STUDENT' || role === 'PARENT'));
  const tenantNavigation = [
    ...coreNavigation.filter((item) => !item.requiredModule || tenant.kind !== 'tenant' || tenant.enabledModules.includes(item.requiredModule)),
    ...(tenant.kind === 'tenant' ? tenant.enabledModules.flatMap((moduleKey) => moduleNavigation[moduleKey] ?? []) : []),
  ];
  const configuredNavigation = tenant.kind === 'platform' ? platformNavigation : tenantNavigation;
  const visibleNavigation = portalOnly
    ? configuredNavigation.filter((item) => item.href === '/portal' || item.href === '/profile')
    : configuredNavigation.filter((item) => item.href !== '/portal' && (item.href !== '/benefits' || user?.permissions.some((permission) => ['benefit.read', 'benefit.configure', 'benefit.assign', 'benefit.approve', 'override.read', 'override.create', 'override.approve'].includes(permission))) && (item.href !== '/payer-responsibilities' || user?.permissions.some((permission) => ['payer.responsibility.read', 'payer.responsibility.configure'].includes(permission))));

  useEffect(() => {
    if (loading || user || loginRoute || path === '/') return;
    router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [loading, user, loginRoute, path, router]);

  useEffect(() => {
    if (!user || loginRoute || user.mustChangePassword) return;
    if (portalOnly && path !== '/portal') router.replace('/portal');
    else if (!portalOnly && path === '/portal') router.replace('/');
  }, [user, loginRoute, portalOnly, path, router]);

  async function handleSignOut() {
    await signOut();
    update(null);
    router.push('/login');
  }

  if (tenant.kind === 'loading') return <main id="main-content" className="auth-frame"><div className="loading-page" role="status">Finding this workspace…</div></main>;
  if (tenant.kind === 'error') return <main id="main-content" className="auth-frame"><section className="tenant-unavailable"><span className="empty-icon"><Building2 /></span><p className="eyebrow">ORGANIZATION WORKSPACE</p><h1>Workspace information is unavailable</h1><p>We could not reach the workspace service. Check your connection and try again.</p><button className="button button-primary" onClick={() => window.location.reload()}>Try again</button></section></main>;
  if ((tenant.kind === 'unknown' || tenant.kind === 'inactive') && path !== '/' && path !== '/login') {
    return <main id="main-content" className="auth-frame"><WorkspaceUnavailable inactive={tenant.kind === 'inactive'} /></main>;
  }
  if (loginRoute) return <main id="main-content" className="auth-frame">{children}</main>;
  if (loading) return <main id="main-content" className="auth-frame"><div className="loading-page" role="status">Checking your sign-in…</div></main>;
  if (!user && path === '/') return <>{children}</>;
  if (tenant.kind === 'unknown' || tenant.kind === 'inactive') return <>{children}</>;
  if (!user) return <main id="main-content" className="auth-frame"><div className="loading-page" role="status">Taking you to sign in…</div></main>;
  if (user?.mustChangePassword && path !== '/change-password') return <main id="main-content" className="page-content auth-required"><span className="empty-icon"><ShieldCheck /></span><h1>Change your temporary password</h1><p>Your administrator created a temporary password for this account. Update it before using the organization workspace.</p><Link className="button button-primary" href="/change-password">Change password</Link></main>;

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label={`${tenant.kind === 'tenant' ? tenant.branding.organizationName : 'Fee Platform'} home`}>
          {tenant.kind === 'tenant' && tenant.branding.logoUrl
            ? <img className="brand-logo" src={tenant.branding.logoUrl} alt="" />
            : <span className="brand-mark"><WalletCards size={19} /></span>}
          <span>{tenant.kind === 'tenant' ? tenant.branding.organizationName : 'Fee Platform'}</span>
        </Link>
        {user && <div className="workspace-chip"><Building2 size={16} /><span>{user.tenantName}</span><ChevronDown size={14} /></div>}
        <nav className="primary-nav" aria-label="Main navigation">
          <p className="nav-section-label">WORKSPACE</p>
          {visibleNavigation.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${path === href || (href !== '/' && path.startsWith(href)) ? 'active' : ''}`}><Icon size={18} /><span>{label}</span></Link>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-note"><span className="security-dot" /><div><strong>Secure workspace</strong><small>Organization data stays private</small></div></div>
          {user && <button className="profile-row" onClick={() => void handleSignOut()}><span className="avatar">{user.firstName.slice(0, 1).toUpperCase()}</span><span className="profile-copy"><strong>{user.firstName} {user.lastName ?? ''}</strong><small>{user.email}</small></span><LogOut size={16} /></button>}
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar"><div className="breadcrumb">{user ? <><span>{user.tenantName}</span><span className="breadcrumb-separator">/</span><strong>{visibleNavigation.find((item) => path === item.href || (item.href !== '/' && path.startsWith(item.href)))?.label ?? 'Workspace'}</strong></> : <span>Organization workspace</span>}</div><div className="topbar-right">{user ? <span className="user-pill"><span className="avatar avatar-small">{user.firstName.slice(0, 1).toUpperCase()}</span>{user.firstName}</span> : <Link className="text-link" href="/login">Sign in</Link>}</div></header>
        {children}
      </div>
    </div>
  );
}

function WorkspaceUnavailable({ inactive }: { inactive: boolean }) {
  return <section className="tenant-unavailable"><span className="empty-icon"><Building2 /></span><p className="eyebrow">ORGANIZATION WORKSPACE</p><h1>{inactive ? 'This workspace is temporarily unavailable' : 'Workspace not found'}</h1><p>{inactive ? 'The organization workspace is currently inactive. Contact the institution administrator for help.' : 'Check the web address or contact your institution for its workspace link.'}</p><a className="button button-secondary" href={platformHomeHref()}>Return to platform home</a></section>;
}
