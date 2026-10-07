'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PLATFORM_SYSTEM_TENANT_SLUG } from '@fee/types';
import { Building2, GraduationCap, LayoutDashboard, LogOut, ReceiptText, Settings2, UsersRound, WalletCards, SlidersHorizontal, RotateCcw, CircleDollarSign, CalendarClock, ShieldCheck, FileText, BarChart3, Scale, BellRing, BadgePercent, GitBranch, UserRound, type LucideIcon } from 'lucide-react';
import { platformSignInHref, signOut, tenantSignInHref } from '../lib/api';
import { useSession } from './session-provider';
import { useTenant } from './tenant-provider';

type NavigationItem = { section: string; href: string; label: string; icon: LucideIcon; requiredModule?: string };

// The workspace shell is generic. Domain routes are contributed by an enabled
// built-in module; education labels therefore never become core navigation.
const coreTenantNavigation: NavigationItem[] = [
  { section: 'WORKSPACE', href: '/', label: 'Overview', icon: LayoutDashboard },
  { section: 'ORGANIZATION & ACCESS', href: '/organization', label: 'Branches and groups', icon: GitBranch, requiredModule: 'BRANCHES' },
  { section: 'ORGANIZATION & ACCESS', href: '/access', label: 'Users and roles', icon: UsersRound, requiredModule: 'USERS' },
  { section: 'OPERATIONS', href: '/reports', label: 'Reports', icon: BarChart3, requiredModule: 'REPORTS' },
  { section: 'OPERATIONS', href: '/notifications', label: 'Notifications', icon: BellRing, requiredModule: 'NOTIFICATIONS' },
  { section: 'OPERATIONS', href: '/settings', label: 'Organization settings', icon: Settings2 },
  { section: 'OPERATIONS', href: '/audit-logs', label: 'Audit logs', icon: ShieldCheck },
  { section: 'ACCOUNT', href: '/profile', label: 'My profile', icon: UserRound },
];

const moduleNavigation: Record<string, NavigationItem[]> = {
  ADMISSIONS: [
    { section: 'ADMISSIONS', href: '/students', label: 'Students', icon: UsersRound },
    { section: 'ADMISSIONS', href: '/admissions', label: 'Admissions', icon: GraduationCap },
    { section: 'ADMISSIONS', href: '/academic', label: 'Academic structure', icon: Building2 },
  ],
  FEES: [
    { section: 'FEES', href: '/sponsors', label: 'Sponsors', icon: Building2 },
    { section: 'FEES', href: '/fee-catalog', label: 'Fee catalog', icon: ReceiptText },
    { section: 'FEES', href: '/fee-structures', label: 'Fee structures', icon: Settings2 },
    { section: 'FEES', href: '/fee-policies', label: 'Rules and policies', icon: SlidersHorizontal },
    { section: 'FEES', href: '/benefits', label: 'Benefits and surcharges', icon: BadgePercent },
    { section: 'FEES', href: '/payer-responsibilities', label: 'Payer responsibilities', icon: CircleDollarSign },
    { section: 'FEES', href: '/fee-assignments', label: 'Fee assignments', icon: WalletCards },
    { section: 'FEES', href: '/fee-demands', label: 'Fee demands', icon: ReceiptText },
    { section: 'FEES', href: '/late-fees', label: 'Late fees', icon: CalendarClock },
    { section: 'FEES', href: '/installments', label: 'Installments', icon: CalendarClock },
    { section: 'FEES', href: '/credits', label: 'Credit balances', icon: CircleDollarSign },
    { section: 'FEES', href: '/adjustments', label: 'Adjustments', icon: BadgePercent },
    { section: 'FEES', href: '/invoices', label: 'Invoices', icon: FileText },
  ],
  PAYMENTS: [
    { section: 'PAYMENTS', href: '/payments', label: 'Payments', icon: WalletCards },
    { section: 'PAYMENTS', href: '/gateways', label: 'Payment gateways', icon: ShieldCheck },
    { section: 'PAYMENTS', href: '/refunds', label: 'Refunds', icon: RotateCcw },
    { section: 'PAYMENTS', href: '/receipts', label: 'Receipts', icon: ReceiptText },
    { section: 'PAYMENTS', href: '/reconciliation', label: 'Reconciliation', icon: Scale },
  ],
  PORTAL: [{ section: 'PORTAL', href: '/portal', label: 'Payer portal', icon: WalletCards }],
};

const platformNavigation = [
  { section: 'PLATFORM', href: '/platform#overview', label: 'Overview', icon: LayoutDashboard },
  { section: 'TENANTS', href: '/platform#tenants', label: 'Tenant directory', icon: Building2 },
  { section: 'TENANTS', href: '/platform#provision', label: 'Provision a tenant', icon: GitBranch },
  { section: 'PLANS & BILLING', href: '/platform#plans', label: 'Plans and subscriptions', icon: CircleDollarSign },
  { section: 'PLATFORM ACCESS', href: '/platform#platform-admins', label: 'Super Admins', icon: UsersRound },
  { section: 'PLATFORM ACCESS', href: '/audit-logs', label: 'Audit logs', icon: ShieldCheck },
  { section: 'ACCOUNT', href: '/profile', label: 'My profile', icon: UserRound },
];

const platformRoutes = ['/', '/platform', '/audit-logs', '/profile', '/change-password'];
export function ApplicationShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, loading, update } = useSession();
  const tenant = useTenant();
  const path = usePathname();
  const router = useRouter();
  const [currentHash, setCurrentHash] = useState('');
  const loginRoute = path === '/login';
  const publicAuthRoute = ['/login', '/register', '/accept-invitation', '/verify-email-change'].includes(path);
  const publicLandingRoute = path === '/';
  const portalOnly = Boolean(user?.roles.length && user.roles.every((role) => role === 'STUDENT' || role === 'PARENT'));
  const isPlatformHost = tenant.kind === 'platform';
  const configuredTenantNavigation = [
    ...coreTenantNavigation.filter((item) => !item.requiredModule || tenant.kind !== 'tenant' || tenant.enabledModules.includes(item.requiredModule)),
    ...(tenant.kind === 'tenant' ? tenant.enabledModules.flatMap((moduleKey) => moduleNavigation[moduleKey] ?? []) : []),
  ];
  const tenantNavigationForUser = portalOnly
    ? configuredTenantNavigation.filter((item) => item.href === '/portal' || item.href === '/profile')
    : configuredTenantNavigation.filter((item) => item.href !== '/portal' && (item.href !== '/organization' || user?.permissions.some((permission) => ['branch.read', 'branch.manage', 'organization.unit.read', 'organization.unit.manage', 'assignment.read', 'assignment.manage'].includes(permission))) && (item.href !== '/benefits' || user?.permissions.some((permission) => ['benefit.read', 'benefit.configure', 'benefit.assign', 'benefit.approve', 'override.read', 'override.create', 'override.approve'].includes(permission))) && (item.href !== '/payer-responsibilities' || user?.permissions.some((permission) => ['payer.responsibility.read', 'payer.responsibility.configure'].includes(permission))));
  const moduleEnabledNavigation = tenantNavigationForUser;
  const visibleNavigation = isPlatformHost ? platformNavigation : moduleEnabledNavigation;
  const navigationGroups = visibleNavigation.reduce<Array<{ section: string; items: typeof visibleNavigation[number][] }>>((groups, item) => {
    const current = groups.at(-1);
    if (current?.section === item.section) current.items.push(item);
    else groups.push({ section: item.section, items: [item] });
    return groups;
  }, []);
  const isHostMismatch = (tenant.kind === 'platform' && Boolean(user && (!user.isPlatformAdmin || user.tenantSlug !== PLATFORM_SYSTEM_TENANT_SLUG)))
    || (tenant.kind === 'tenant' && Boolean(user && (user.isPlatformAdmin || (user.tenantSlug && user.tenantSlug !== tenant.slug))));
  const activeNavigationItem = visibleNavigation.find((item) => isNavigationActive(item.href, path, currentHash));

  useEffect(() => {
    const syncHash = () => setCurrentHash(window.location.hash);
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, [path]);

  useEffect(() => {
    if (loading || user || publicAuthRoute || publicLandingRoute) return;
    router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [loading, user, publicAuthRoute, publicLandingRoute, path, router]);

  useEffect(() => {
    if (!user?.isPlatformAdmin || !isPlatformHost || user.mustChangePassword || publicAuthRoute) return;
    if (!platformRoutes.includes(path)) router.replace('/platform');
  }, [user, isPlatformHost, publicAuthRoute, path, router]);

  useEffect(() => {
    if (!user || publicAuthRoute || user.mustChangePassword) return;
    if (portalOnly && path !== '/portal' && path !== '/profile') router.replace('/portal');
    else if (!portalOnly && path === '/portal') router.replace('/');
  }, [user, publicAuthRoute, portalOnly, path, router]);

  async function handleSignOut() {
    await signOut();
    update(null);
    router.push('/login');
  }

  if (tenant.kind === 'loading') return <main id="main-content" className="auth-frame"><div className="loading-page" role="status">Finding this workspace…</div></main>;
  if (tenant.kind === 'error') return <main id="main-content" className="auth-frame"><section className="tenant-unavailable"><span className="empty-icon"><Building2 /></span><p className="eyebrow">ORGANIZATION WORKSPACE</p><h1>Workspace information is unavailable</h1><p>We could not reach the workspace service. Check your connection and try again.</p><button className="button button-primary" onClick={() => window.location.reload()}>Try again</button></section></main>;
  if ((tenant.kind === 'unknown' || tenant.kind === 'inactive') && !publicLandingRoute && !publicAuthRoute) {
    return <main id="main-content" className="auth-frame"><WorkspaceUnavailable inactive={tenant.kind === 'inactive'} /></main>;
  }
  if (loginRoute) return <main id="main-content" className="auth-frame">{children}</main>;
  if (publicAuthRoute || (publicLandingRoute && isHostMismatch && user)) return <>{children}</>;
  if (isHostMismatch && user) return <main id="main-content" className="auth-frame"><section className="tenant-unavailable" aria-labelledby="account-scope-title"><span className="empty-icon"><ShieldCheck /></span><p className="eyebrow">ACCOUNT SCOPE</p><h1 id="account-scope-title">This account belongs to another workspace</h1><p>{tenant.kind === 'platform'
    ? 'Organization accounts must sign in on their own workspace address.'
    : user.isPlatformAdmin
      ? 'Platform administrators must use the dedicated platform address.'
      : `This address belongs to ${tenant.name}. Your account is scoped to ${user.tenantName}.`}</p><div className="profile-settings-actions"><a className="button button-primary" href={tenant.kind === 'platform' ? tenantSignInHref(user.tenantSlug) : user.isPlatformAdmin ? platformSignInHref() : tenantSignInHref(user.tenantSlug)}>Open the correct sign-in</a><button className="button button-secondary" onClick={() => void handleSignOut()}>Sign out here</button></div></section></main>;
  if (isPlatformHost && user?.isPlatformAdmin && !user.mustChangePassword && !publicAuthRoute && !platformRoutes.includes(path)) return <main id="main-content" className="auth-frame"><div className="loading-page" role="status">Opening the platform control plane…</div></main>;
  if (loading) return <main id="main-content" className="auth-frame"><div className="loading-page" role="status">Checking your sign-in…</div></main>;
  if (!user && publicLandingRoute) return <>{children}</>;
  if (tenant.kind === 'unknown' || tenant.kind === 'inactive') return <>{children}</>;
  if (!user) return <main id="main-content" className="auth-frame"><div className="loading-page" role="status">Taking you to sign in…</div></main>;
  if (user?.mustChangePassword && path !== '/change-password') return <main id="main-content" className="page-content auth-required"><span className="empty-icon"><ShieldCheck /></span><h1>Change your temporary password</h1><p>Your administrator created a temporary password for this account. Update it before using the tenant workspace.</p><Link className="button button-primary" href="/change-password">Change password</Link></main>;

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label={`${tenant.kind === 'tenant' ? tenant.branding.organizationName : 'Workspace Platform'} home`}>
          {tenant.kind === 'tenant' && tenant.branding.logoUrl
            ? <img className="brand-logo" src={tenant.branding.logoUrl} alt="" />
            : <span className="brand-mark"><WalletCards size={19} /></span>}
          <span>{tenant.kind === 'tenant' ? tenant.branding.organizationName : 'Workspace Platform'}</span>
        </Link>
        {user && <div className="workspace-chip"><Building2 size={16} /><span>{isPlatformHost ? 'Platform control plane' : user.tenantName}</span></div>}
        <nav className="primary-nav" aria-label="Main navigation">
          {navigationGroups.map((group, index) => <div className={`nav-group${index > 0 ? ' nav-section-spaced' : ''}`} key={group.section}>
            <p className="nav-section-label">{group.section}</p>
            {group.items.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${isNavigationActive(href, path, currentHash) ? 'active' : ''}`}><Icon size={18} /><span>{label}</span></Link>)}
          </div>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-note"><span className="security-dot" /><div><strong>{isPlatformHost ? 'Platform control plane' : 'Tenant workspace'}</strong><small>{isPlatformHost ? 'Platform operator access' : 'Organization data stays private'}</small></div></div>
          {user && <button className="profile-row" onClick={() => void handleSignOut()}><span className="avatar">{user.firstName.slice(0, 1).toUpperCase()}</span><span className="profile-copy"><strong>{user.firstName} {user.lastName ?? ''}</strong><small>{user.email}</small></span><LogOut size={16} /></button>}
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar"><div className="breadcrumb">{user ? <><span>{isPlatformHost ? 'Platform' : user.tenantName}</span><span className="breadcrumb-separator">/</span><strong>{activeNavigationItem?.label ?? 'Workspace'}</strong></> : <span>Tenant workspace</span>}</div><div className="topbar-right">{user ? <span className="user-pill"><span className="avatar avatar-small">{user.firstName.slice(0, 1).toUpperCase()}</span>{user.firstName}</span> : <Link className="text-link" href="/login">Sign in</Link>}</div></header>
        {children}
      </div>
    </div>
  );
}

function isNavigationActive(href: string, path: string, currentHash: string): boolean {
  const hashIndex = href.indexOf('#');
  const targetPath = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const targetHash = hashIndex === -1 ? '' : href.slice(hashIndex);
  if (targetPath !== path && !(targetPath !== '/' && path.startsWith(`${targetPath}/`))) return false;
  if (targetHash) return (currentHash || '#overview') === targetHash;
  return true;
}

function WorkspaceUnavailable({ inactive }: { inactive: boolean }) {
  return <section className="tenant-unavailable" aria-labelledby="workspace-unavailable-title"><span className="empty-icon"><Building2 /></span><p className="eyebrow">ORGANIZATION WORKSPACE</p><h1 id="workspace-unavailable-title">{inactive ? 'This workspace is temporarily unavailable' : 'Workspace not found'}</h1><p>{inactive ? 'This organization workspace is currently inactive. Contact its administrator for help.' : 'Check the web address or contact your organization for its workspace link.'}</p><a className="button button-secondary" href={platformSignInHref()}>Return to platform sign in</a></section>;
}
