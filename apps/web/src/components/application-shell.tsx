'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PLATFORM_SYSTEM_TENANT_SLUG, PERMISSIONS, organizationCategory } from '@fee/types';
import { Building2, GraduationCap, LayoutDashboard, LogOut, ReceiptText, Settings2, UsersRound, WalletCards, SlidersHorizontal, RotateCcw, CircleDollarSign, CalendarClock, ShieldCheck, FileText, BarChart3, Scale, BellRing, BadgePercent, GitBranch, UserRound, Menu, X, ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';
import { platformSignInHref, signOut, tenantSignInHref } from '../lib/api';
import { useSession } from './session-provider';
import { useTenant } from './tenant-provider';
import Breadcrumbs from './breadcrumbs';

type NavigationItem = { section: string; href: string; label: string; icon: LucideIcon; requiredModule?: string; requiredPermissions?: readonly string[] };

// The workspace shell is generic. Domain routes are contributed by an enabled
// built-in module; education labels therefore never become core navigation.
const coreTenantNavigation: NavigationItem[] = [
  { section: 'WORKSPACE', href: '/', label: 'Overview', icon: LayoutDashboard },
  { section: 'ORGANIZATION & ACCESS', href: '/organization', label: 'Branches and groups', icon: GitBranch, requiredModule: 'BRANCHES', requiredPermissions: [PERMISSIONS.BRANCH_READ, PERMISSIONS.BRANCH_MANAGE, PERMISSIONS.ORGANIZATION_UNIT_READ, PERMISSIONS.ORGANIZATION_UNIT_MANAGE, PERMISSIONS.ASSIGNMENT_READ, PERMISSIONS.ASSIGNMENT_MANAGE] },
  { section: 'ORGANIZATION & ACCESS', href: '/access', label: 'Users and roles', icon: UsersRound, requiredModule: 'USERS', requiredPermissions: [PERMISSIONS.USER_READ, PERMISSIONS.ROLE_READ, PERMISSIONS.PERMISSION_READ] },
  { section: 'OPERATIONS', href: '/reports', label: 'Reports', icon: BarChart3, requiredModule: 'REPORTS', requiredPermissions: [PERMISSIONS.REPORT_READ] },
  { section: 'OPERATIONS', href: '/notifications', label: 'Notifications', icon: BellRing, requiredModule: 'NOTIFICATIONS', requiredPermissions: [PERMISSIONS.TENANT_SETTINGS_READ] },
  { section: 'OPERATIONS', href: '/settings', label: 'Organization settings', icon: Settings2, requiredPermissions: [PERMISSIONS.TENANT_SETTINGS_READ, PERMISSIONS.TENANT_SETTINGS_UPDATE, PERMISSIONS.TENANT_BRANDING_UPDATE] },
  { section: 'OPERATIONS', href: '/audit-logs', label: 'Audit logs', icon: ShieldCheck, requiredPermissions: [PERMISSIONS.AUDIT_READ] },
  { section: 'ACCOUNT', href: '/profile', label: 'My profile', icon: UserRound },
];

const moduleNavigation: Record<string, NavigationItem[]> = {
  ADMISSIONS: [
    { section: 'ADMISSIONS', href: '/students', label: 'Students', icon: UsersRound, requiredPermissions: [PERMISSIONS.STUDENT_READ] },
    { section: 'ADMISSIONS', href: '/admissions', label: 'Admissions', icon: GraduationCap, requiredPermissions: [PERMISSIONS.ADMISSION_READ] },
    { section: 'ADMISSIONS', href: '/academic', label: 'Academic structure', icon: Building2, requiredPermissions: [PERMISSIONS.STUDENT_READ, PERMISSIONS.ORGANIZATION_UNIT_READ, PERMISSIONS.ASSIGNMENT_READ] },
  ],
  FEES: [
    { section: 'FEES', href: '/sponsors', label: 'Sponsors', icon: Building2, requiredPermissions: [PERMISSIONS.SPONSOR_READ] },
    { section: 'FEES', href: '/fee-catalog', label: 'Fee catalog', icon: ReceiptText, requiredPermissions: [PERMISSIONS.FEE_CATALOG_READ] },
    { section: 'FEES', href: '/fee-structures', label: 'Fee structures', icon: Settings2, requiredPermissions: [PERMISSIONS.FEE_STRUCTURE_READ] },
    { section: 'FEES', href: '/fee-policies', label: 'Rules and policies', icon: SlidersHorizontal, requiredPermissions: [PERMISSIONS.FEE_POLICY_READ] },
    { section: 'FEES', href: '/benefits', label: 'Benefits and surcharges', icon: BadgePercent, requiredPermissions: [PERMISSIONS.BENEFIT_READ, PERMISSIONS.OVERRIDE_READ, PERMISSIONS.BENEFIT_CONFIGURE, PERMISSIONS.BENEFIT_ASSIGN, PERMISSIONS.OVERRIDE_CREATE, PERMISSIONS.OVERRIDE_APPROVE] },
    { section: 'FEES', href: '/payer-responsibilities', label: 'Payer responsibilities', icon: CircleDollarSign, requiredPermissions: [PERMISSIONS.PAYER_RESPONSIBILITY_READ, PERMISSIONS.PAYER_RESPONSIBILITY_CONFIGURE] },
    { section: 'FEES', href: '/fee-assignments', label: 'Fee assignments', icon: WalletCards, requiredPermissions: [PERMISSIONS.FEE_ASSIGNMENT_READ] },
    { section: 'FEES', href: '/fee-demands', label: 'Fee demands', icon: ReceiptText, requiredPermissions: [PERMISSIONS.FEE_DEMAND_READ] },
    { section: 'FEES', href: '/late-fees', label: 'Late fees', icon: CalendarClock, requiredPermissions: [PERMISSIONS.FEE_DEMAND_READ] },
    { section: 'FEES', href: '/installments', label: 'Installments', icon: CalendarClock, requiredPermissions: [PERMISSIONS.FEE_DEMAND_READ] },
    { section: 'FEES', href: '/credits', label: 'Credit balances', icon: CircleDollarSign, requiredPermissions: [PERMISSIONS.CREDIT_READ] },
    { section: 'FEES', href: '/adjustments', label: 'Adjustments', icon: BadgePercent, requiredPermissions: [PERMISSIONS.ADJUSTMENT_READ] },
    { section: 'FEES', href: '/invoices', label: 'Invoices', icon: FileText, requiredPermissions: [PERMISSIONS.INVOICE_READ] },
  ],
  PAYMENTS: [
    { section: 'PAYMENTS', href: '/payments', label: 'Payments', icon: WalletCards, requiredPermissions: [PERMISSIONS.PAYMENT_READ, PERMISSIONS.PAYMENT_COLLECT] },
    { section: 'PAYMENTS', href: '/gateways', label: 'Payment gateways', icon: ShieldCheck, requiredPermissions: [PERMISSIONS.TENANT_SETTINGS_READ] },
    { section: 'PAYMENTS', href: '/refunds', label: 'Refunds', icon: RotateCcw, requiredPermissions: [PERMISSIONS.PAYMENT_REFUND, PERMISSIONS.PAYMENT_REFUND_APPROVE] },
    { section: 'PAYMENTS', href: '/receipts', label: 'Receipts', icon: ReceiptText, requiredPermissions: [PERMISSIONS.RECEIPT_READ] },
    { section: 'PAYMENTS', href: '/reconciliation', label: 'Reconciliation', icon: Scale, requiredPermissions: [PERMISSIONS.RECONCILIATION_READ] },
  ],
  PORTAL: [{ section: 'PORTAL', href: '/portal', label: 'Payer portal', icon: WalletCards }],
};

const platformNavigation = [
  { section: 'PLATFORM', href: '/platform', label: 'Overview', icon: LayoutDashboard },
  { section: 'WORKSPACES', href: '/platform/tenants', label: 'Organisations', icon: Building2 },
  { section: 'WORKSPACES', href: '/platform/provision', label: 'Provision a tenant', icon: GitBranch },
  { section: 'COMMERCIAL', href: '/platform/plans', label: 'Plans and billing', icon: CircleDollarSign },
  { section: 'PLATFORM ACCESS', href: '/platform/admins', label: 'Platform admins', icon: UsersRound },
  { section: 'PLATFORM ACCESS', href: '/audit-logs', label: 'Audit logs', icon: ShieldCheck },
  { section: 'ACCOUNT', href: '/profile', label: 'My profile', icon: UserRound },
];

const platformRoutes = ['/platform', '/platform/tenants', '/platform/provision', '/platform/plans', '/platform/admins', '/audit-logs', '/profile', '/change-password'];
export function ApplicationShell({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, loading, update } = useSession();
  const tenant = useTenant();
  const path = usePathname();
  const router = useRouter();
  const [currentHash, setCurrentHash] = useState('');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  const [provisioningDirty, setProvisioningDirty] = useState(false);
  const loginRoute = path === '/login';
  const publicAuthRoute = ['/login', '/register', '/accept-invitation', '/verify-email-change', '/forgot-password', '/reset-password'].includes(path);
  const publicLandingRoute = path === '/';
  const portalOnly = Boolean(user?.roles.length && user.roles.every((role) => role === 'STUDENT' || role === 'PARENT'));
  const isPlatformHost = tenant.kind === 'platform';
  const configuredTenantNavigation = [
    ...coreTenantNavigation.filter((item) => (!item.requiredModule || tenant.kind !== 'tenant' || tenant.enabledModules.includes(item.requiredModule)) && (!item.requiredPermissions || item.requiredPermissions.some((permission) => user?.permissions.includes(permission)))),
    ...(tenant.kind === 'tenant' ? tenant.enabledModules.flatMap((moduleKey) => moduleNavigation[moduleKey] ?? []) : []),
  ];
  const tenantNavigationForUser = portalOnly
    ? configuredTenantNavigation.filter((item) => item.href === '/portal' || item.href === '/profile')
    : configuredTenantNavigation.filter((item) => item.href !== '/portal' && hasAnyPermission(user?.permissions, item.requiredPermissions));
  const category = tenant.kind === 'tenant' ? organizationCategory(tenant.organizationCategory) : null;
  const moduleEnabledNavigation = tenantNavigationForUser.map((item) => item.href === '/organization' && category
    ? { ...item, label: category.groupLabel === 'Batches' || category.groupLabel === 'Batches and groups' ? 'Branches and batches' : category.groupLabel === 'Departments and groups' ? 'Branches and departments' : category.groupLabel.startsWith('Classes') ? 'Branches and classes' : 'Branches and groups' }
    : item);
  const visibleNavigation = isPlatformHost ? platformNavigation : moduleEnabledNavigation;
  const navigationGroups = visibleNavigation.reduce<Array<{ section: string; items: typeof visibleNavigation[number][] }>>((groups, item) => {
    const current = groups.at(-1);
    if (current?.section === item.section) current.items.push(item);
    else groups.push({ section: item.section, items: [item] });
    return groups;
  }, []);
  const isHostMismatch = (tenant.kind === 'platform' && Boolean(user && (!user.isPlatformAdmin || user.tenantSlug !== PLATFORM_SYSTEM_TENANT_SLUG)))
    || (tenant.kind === 'tenant' && Boolean(user && (user.isPlatformAdmin || (user.tenantSlug && user.tenantSlug !== tenant.slug))));
  const activeNavigationItem = [...visibleNavigation].filter((item) => isNavigationActive(item.href, path, currentHash)).sort((left, right) => right.href.split('#')[0]!.length - left.href.split('#')[0]!.length)[0];
  const [expandedSections, setExpandedSections] = useState<string[]>(() => isPlatformHost
    ? navigationGroups.map(({ section }) => section)
    : portalOnly
      ? ['PORTAL', 'ACCOUNT']
      : [...new Set([activeNavigationItem?.section, 'ORGANIZATION & ACCESS', 'ACCOUNT'].filter((section): section is string => Boolean(section)))]);

  useEffect(() => {
    if (!activeNavigationItem) return;
    setExpandedSections((current) => current.includes(activeNavigationItem.section) ? current : [...current, activeNavigationItem.section]);
  }, [activeNavigationItem?.section]);

  useEffect(() => {
    const syncHash = () => setCurrentHash(window.location.hash);
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, [path]);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const syncScreenSize = () => {
      setIsSmallScreen(media.matches);
      if (!media.matches) setMobileNavOpen(false);
    };
    syncScreenSize();
    media.addEventListener('change', syncScreenSize);
    return () => media.removeEventListener('change', syncScreenSize);
  }, []);

  useEffect(() => {
    const handleDirtyState = (event: Event) => setProvisioningDirty(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener('wasl:provision-dirty', handleDirtyState);
    return () => window.removeEventListener('wasl:provision-dirty', handleDirtyState);
  }, []);

  useEffect(() => {
    if (loading || user || publicAuthRoute || publicLandingRoute) return;
    router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [loading, user, publicAuthRoute, publicLandingRoute, path, router]);

  useEffect(() => {
    if (!user?.isPlatformAdmin || !isPlatformHost || user.mustChangePassword || publicAuthRoute) return;
    if (!platformRoutes.includes(path) && !/^\/platform\/tenants\/[^/]+$/.test(path)) router.replace('/platform');
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

  function handleShellNavigation(event: React.MouseEvent<HTMLAnchorElement>) {
    if (path === '/platform/provision' && provisioningDirty && event.currentTarget.pathname !== path) {
      if (!window.confirm('Leave tenant setup? Your unsaved changes will be discarded.')) {
        event.preventDefault();
        return;
      }
      setProvisioningDirty(false);
    }
    setMobileNavOpen(false);
  }

  function handleAccountNavigation(event: React.MouseEvent<HTMLAnchorElement>) {
    handleShellNavigation(event);
    if (!event.defaultPrevented) event.currentTarget.closest('details')?.removeAttribute('open');
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
  if (isPlatformHost && user?.isPlatformAdmin && !user.mustChangePassword && !publicAuthRoute && !platformRoutes.includes(path) && !/^\/platform\/tenants\/[^/]+$/.test(path)) return <main id="main-content" className="auth-frame"><div className="loading-page" role="status">Opening the platform control plane…</div></main>;
  if (loading) return <main id="main-content" className="auth-frame"><div className="loading-page" role="status">Checking your sign-in…</div></main>;
  if (!user && publicLandingRoute) return <>{children}</>;
  if (tenant.kind === 'unknown' || tenant.kind === 'inactive') return <>{children}</>;
  if (!user) return <main id="main-content" className="auth-frame"><div className="loading-page" role="status">Taking you to sign in…</div></main>;
  if (user?.mustChangePassword && path !== '/change-password') return <main id="main-content" className="page-content auth-required"><span className="empty-icon"><ShieldCheck /></span><h1>Change your temporary password</h1><p>Your administrator created a temporary password for this account. Update it before using the tenant workspace.</p><Link className="button button-primary" href="/change-password">Change password</Link></main>;

  return (
    <div className={`app-layout${sidebarCollapsed ? ' sidebar-collapsed' : ''}${mobileNavOpen ? ' mobile-nav-open' : ''}`}>
      {mobileNavOpen && <button type="button" className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
      <aside id="application-sidebar" className="sidebar">
        <Link className="brand" href="/" aria-label={`${tenant.kind === 'tenant' ? tenant.branding.organizationName : 'Wasl'} home`}>
          {tenant.kind === 'tenant' && tenant.branding.logoUrl
            ? <img className="brand-logo" src={tenant.branding.logoUrl} alt="" />
            : tenant.kind === 'platform'
              ? <img className="brand-logo wasl-sidebar-logo" src="/wasl-logo.svg" alt="" />
              : <span className="brand-mark"><WalletCards size={19} /></span>}
          <span>{tenant.kind === 'tenant' ? tenant.branding.organizationName : 'Wasl'}</span>
        </Link>
        {user && <div className="workspace-chip"><Building2 size={16} /><span>{isPlatformHost ? 'Platform control plane' : user.tenantName}</span></div>}
        <nav className="primary-nav" aria-label="Main navigation">
          {navigationGroups.map((group, index) => {
            const groupOpen = (sidebarCollapsed && !mobileNavOpen) || expandedSections.includes(group.section);
            return <div className={`nav-group${index > 0 ? ' nav-section-spaced' : ''}`} key={group.section}>
            <button type="button" className="nav-section-toggle" aria-expanded={groupOpen} aria-controls={`nav-section-${index}`} onClick={() => setExpandedSections((current) => groupOpen ? current.filter((section) => section !== group.section) : [...current, group.section])}>
              <span className="nav-section-label">{group.section}</span><ChevronDown size={14} aria-hidden="true" />
            </button>
            <div id={`nav-section-${index}`} className="nav-section-links" hidden={!groupOpen}>
            {group.items.map(({ href, label, icon: Icon }) => <Link key={href} href={href} title={sidebarCollapsed ? label : undefined} aria-current={isNavigationActive(href, path, currentHash) ? 'page' : undefined} onClick={handleShellNavigation} className={`nav-link ${isNavigationActive(href, path, currentHash) ? 'active' : ''}`}><Icon size={18} /><span>{label}</span></Link>)}
            </div>
          </div>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="security-note"><span className="security-dot" /><div><strong>{isPlatformHost ? 'Platform control plane' : 'Tenant workspace'}</strong><small>{isPlatformHost ? 'Platform operator access' : 'Organization data stays private'}</small></div></div>
          {user && <Link className="profile-row" href="/profile" onClick={handleShellNavigation}><span className="avatar">{user.firstName.slice(0, 1).toUpperCase()}</span><span className="profile-copy"><strong>{user.firstName} {user.lastName ?? ''}</strong><small>{user.email}</small></span><ChevronRight size={16} aria-hidden="true" /></Link>}
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar"><button type="button" className="topbar-menu-button" aria-label={isSmallScreen ? mobileNavOpen ? 'Close navigation' : 'Open navigation' : sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-controls="application-sidebar" aria-expanded={isSmallScreen ? mobileNavOpen : !sidebarCollapsed} onClick={() => { if (isSmallScreen) setMobileNavOpen((open) => !open); else setSidebarCollapsed((collapsed) => !collapsed); }}>{mobileNavOpen ? <X size={18} /> : <Menu size={18} />}</button>{user ? <Breadcrumbs pathname={path} workspaceName={isPlatformHost ? 'Wasl Platform' : user.tenantName} items={visibleNavigation} onNavigate={handleShellNavigation} /> : <nav className="breadcrumb" aria-label="Breadcrumb"><span>Tenant workspace</span></nav>}<div className="topbar-right">{user ? <details className="account-menu"><summary className="user-pill" aria-label={`Account menu for ${user.firstName}`}><span className="avatar avatar-small">{user.firstName.slice(0, 1).toUpperCase()}</span><span>{user.firstName}</span><ChevronDown size={14} aria-hidden="true" /></summary><div className="account-menu-popover"><Link href="/profile" onClick={handleAccountNavigation}><UserRound size={15} /> My profile</Link><Link href="/change-password" onClick={handleAccountNavigation}><ShieldCheck size={15} /> Change password</Link><button type="button" onClick={() => void handleSignOut()}><LogOut size={15} /> Sign out</button></div></details> : <Link className="text-link" href="/login">Sign in</Link>}</div></header>
        {children}
      </div>
    </div>
  );
}

function isNavigationActive(href: string, path: string, currentHash: string): boolean {
  const hashIndex = href.indexOf('#');
  const targetPath = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const targetHash = hashIndex === -1 ? '' : href.slice(hashIndex);
  if (targetPath === '/platform' && path !== targetPath) return false;
  if (targetPath !== path && !(targetPath !== '/' && path.startsWith(`${targetPath}/`))) return false;
  if (targetHash) return (currentHash || '#overview') === targetHash;
  return true;
}

function hasAnyPermission(userPermissions: readonly string[] | undefined, requiredPermissions?: readonly string[]): boolean {
  return !requiredPermissions || requiredPermissions.some((permission) => userPermissions?.includes(permission));
}

function WorkspaceUnavailable({ inactive }: { inactive: boolean }) {
  return <section className="tenant-unavailable" aria-labelledby="workspace-unavailable-title"><span className="empty-icon"><Building2 /></span><p className="eyebrow">ORGANIZATION WORKSPACE</p><h1 id="workspace-unavailable-title">{inactive ? 'This workspace is temporarily unavailable' : 'Workspace not found'}</h1><p>{inactive ? 'This organization workspace is currently inactive. Contact its administrator for help.' : 'Check the web address or contact your organization for its workspace link.'}</p><a className="button button-secondary" href={platformSignInHref()}>Return to platform sign in</a></section>;
}
