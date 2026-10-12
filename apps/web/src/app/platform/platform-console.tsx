'use client';
import { formatIndianCurrency, formatIndianDate, formatIndianDateTime, formatIndianNumber } from '../../lib/locale';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Building2, CreditCard, ExternalLink, Globe2, Layers3, ReceiptText, RefreshCw, Search, ShieldCheck, UsersRound } from 'lucide-react';
import { CORE_TENANT_MODULES, PLATFORM_MODULES, PLATFORM_MODULE_LABELS, SUBSCRIPTION_STATUSES, TENANT_STATUSES, USER_STATUSES, enumLabel, organizationCategoryDisplayName } from '@fee/types';
import { ApiError, apiRequest } from '../../lib/api';
import { useSession } from '../../components/session-provider';
import { useTenant } from '../../components/tenant-provider';
import ProvisionTenantWizard, { type TenantProvisionPayload } from './provision-tenant-wizard';
import { buildProvisionTenantRequest } from './provisioning-idempotency';

type TenantStatus = (typeof TENANT_STATUSES)[number];
type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
type UserStatus = (typeof USER_STATUSES)[number];
type PlatformView = 'overview' | 'tenants' | 'tenant-details' | 'plans' | 'admins' | 'provision';
interface TenantUsage { totalUsers: number; activeUsers: number; activeTenantAdmins: number; branches: number; organizationUnits: number; recordedPayments: number | null; latestSignInAt: string | null }
interface TenantRow {
  id: string; slug: string; tenantHost: string; name: string; organizationType: string; enabledModules: string[]; status: TenantStatus; contactEmail: string | null; contactPhone: string | null; countryCode: string | null;
  trialEndsAt: string | null; subscriptionPlan: string | null; subscriptionStatus: SubscriptionStatus; subscriptionRenewalAt: string | null; createdAt: string; updatedAt?: string; usage: TenantUsage;
}
interface PageResult<T> { items: T[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }
interface RoleLink { role: { id: string; key: string; name: string } }
interface UserRow { id: string; email: string; phone: string | null; firstName: string; lastName: string | null; status: UserStatus; mustChangePassword: boolean; lastLoginAt: string | null; createdAt: string; userRoles: RoleLink[] }
interface RoleRow { id: string; key: string; name: string; isSystem: boolean }
interface SuperAdminRow { id: string; email: string; firstName: string; lastName: string | null; status: UserStatus; mustChangePassword: boolean; lastLoginAt: string | null; createdAt: string; invitationExpiresAt: string | null; emailVerifiedAt: string | null }
interface Overview {
  totalTenants: number; tenantStatuses: Record<TenantStatus, number>; subscriptionStatuses: Record<SubscriptionStatus, number>; activeSuperAdmins: number;
  activePlans: number;
  subscriptionsByCurrency: Array<{ currency: string; activeCount: number; trialCount: number; monthlyRecurringRevenue: string }>;
  invoicesByCurrency: Array<{ currency: string; openCount: number; overdueCount: number; outstandingAmount: string }>;
  requestedRefundsByCurrency: Array<{ currency: string; count: number; amount: string }>;
  domains: { verified: number; pending: number };
}
interface PlanRow { id: string; key: string; name: string; description: string | null; monthlyPrice: string; yearlyPrice: string; currency: string; trialDays: number; active: boolean; modules: Array<{ moduleKey: string; enabled: boolean }>; entitlements: Array<{ entitlementKey: string; limitValue: number | null }>; _count: { subscriptions: number } }
interface TenantSubscription {
  id: string; planId: string; status: SubscriptionStatus; billingInterval: 'MONTHLY' | 'YEARLY' | 'MANUAL'; amount: string; currency: string; trialEndsAt: string | null; currentPeriodStart: string | null; currentPeriodEnd: string | null; isCurrent: boolean; cancelAtPeriodEnd: boolean; cancelledAt: string | null; plan: { id: string; key: string; name: string };
  invoices: Array<{ id: string; invoiceNumber: string; status: string; currency: string; subtotal: string; tax: string; total: string; dueAt: string; paidAt: string | null; payments: Array<{ id: string; provider: string; providerPaymentId: string | null; status: string; amount: string; currency: string; paidAt: string | null; refunds: Array<{ id: string; status: string; amount: string; currency: string; reason: string; externalRefundId: string | null }> }> }>;
}
interface TenantFeatureAccess {
  plan: { id: string; key: string; name: string; modules: Array<{ moduleKey: string; enabled: boolean }>; entitlements: Array<{ entitlementKey: string; limitValue: number | null }> } | null;
  modules: Array<{ moduleKey: string; planEnabled: boolean; enabled: boolean; override: { enabled: boolean; reason: string | null } | null }>;
  entitlements: Array<{ entitlementKey: string; planLimit: number | null; limit: number | null; usage: number | null; override: { limitValue: number | null; reason: string } | null }>;
}
interface TenantDomainRow {
  id: string; tenantId: string; domain: string; isPrimary: boolean; verifiedAt: string | null; createdAt: string;
  verificationRecordName: string; verificationRecordValue: string | null;
}
interface TenantBranchRow {
  id: string; code: string; name: string; status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED'; managerId: string | null;
  phone: string | null; email: string | null; capacity: number | null; address: Record<string, unknown> | null;
  updatedAt: string; members: Array<{ userId: string; isPrimary: boolean }>; memberCount: number;
  manager: { id: string; firstName: string; lastName: string | null; email: string } | null;
}
interface PlanPayload { key?: string; name: string; description: string | null; monthlyPrice?: number; yearlyPrice?: number; currency?: string; trialDays?: number; active: boolean; modules?: string[]; entitlements?: Array<{ entitlementKey: string; limitValue: number | null }> }

const PAGE_SIZE = 12;
const TENANT_DETAIL_TABS = [
  ['overview', 'Overview'], ['organization', 'Organization'], ['users', 'Users & administrators'],
  ['modules', 'Modules & limits'], ['billing', 'Subscription & billing'], ['domains', 'Domains & security'],
] as const;
type TenantDetailTab = (typeof TENANT_DETAIL_TABS)[number][0];

export default function PlatformConsole() {
  const { user } = useSession();
  const tenant = useTenant();
  const pathname = usePathname();
  const router = useRouter();
  const activeView = platformViewFromPath(pathname);
  const tenantDetailsId = pathname.match(/^\/platform\/tenants\/([^/]+)$/)?.[1] ?? null;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [tenants, setTenants] = useState<PageResult<TenantRow> | null>(null);
  const [superAdmins, setSuperAdmins] = useState<PageResult<SuperAdminRow> | null>(null);
  const [superAdminSearch, setSuperAdminSearch] = useState('');
  const [superAdminStatus, setSuperAdminStatus] = useState('');
  const [superAdminPage, setSuperAdminPage] = useState(1);
  const [tenantSearch, setTenantSearch] = useState('');
  const [tenantStatusFilter, setTenantStatusFilter] = useState('');
  const [subscriptionFilter, setSubscriptionFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedTenant, setSelectedTenant] = useState<TenantRow | null>(null);
  const [tenantDetailsLoading, setTenantDetailsLoading] = useState(false);
  const [tenantUsers, setTenantUsers] = useState<PageResult<UserRow> | null>(null);
  const [tenantRoles, setTenantRoles] = useState<RoleRow[]>([]);
  const [tenantSubscriptions, setTenantSubscriptions] = useState<TenantSubscription[]>([]);
  const [tenantFeatures, setTenantFeatures] = useState<TenantFeatureAccess | null>(null);
  const [tenantDomains, setTenantDomains] = useState<TenantDomainRow[]>([]);
  const [tenantBranches, setTenantBranches] = useState<TenantBranchRow[]>([]);
  const [tenantDetailTab, setTenantDetailTab] = useState<TenantDetailTab>('overview');
  const [tenantCategoryEdited, setTenantCategoryEdited] = useState(false);
  const [tenantBranchUsers, setTenantBranchUsers] = useState<UserRow[]>([]);
  const [tenantBranchMemberSelections, setTenantBranchMemberSelections] = useState<Record<string, string[]>>({});
  const [userPage, setUserPage] = useState(1);
  const [userFilter, setUserFilter] = useState<'all' | 'admins'>('admins');
  const [userSearch, setUserSearch] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState('');
  const [userRoleSelections, setUserRoleSelections] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [newTenant, setNewTenant] = useState<{ id: string; name: string; tenantHost: string; tenantAdminEmail: string; invitationExpiresAt: string } | null>(null);
  const [provisioningDirty, setProvisioningDirty] = useState(false);

  const loadOverview = useCallback(async () => {
    const result = await apiRequest<Overview>('/platform/overview');
    setOverview(result);
  }, []);

  const loadTenants = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort: '-createdAt' });
    if (tenantSearch.trim()) params.set('search', tenantSearch.trim());
    if (tenantStatusFilter) params.set('status', tenantStatusFilter);
    if (subscriptionFilter) params.set('subscriptionStatus', subscriptionFilter);
    const result = await apiRequest<PageResult<TenantRow>>('/platform/tenants?' + params.toString());
    setTenants(result);
  }, [page, tenantSearch, tenantStatusFilter, subscriptionFilter]);

  const loadSuperAdmins = useCallback(async () => {
    const params = new URLSearchParams({ page: String(superAdminPage), pageSize: String(PAGE_SIZE), sort: 'firstName' });
    if (superAdminSearch.trim()) params.set('search', superAdminSearch.trim());
    if (superAdminStatus) params.set('status', superAdminStatus);
    const result = await apiRequest<PageResult<SuperAdminRow>>('/platform/super-admins?' + params.toString());
    setSuperAdmins(result);
  }, [superAdminPage, superAdminSearch, superAdminStatus]);

  const loadPlans = useCallback(async () => {
    setPlans(await apiRequest<PlanRow[]>('/platform/plans'));
  }, []);

  const loadTenantSubscriptions = useCallback(async (tenantId: string) => {
    try { setTenantSubscriptions(await apiRequest<TenantSubscription[]>(`/platform/tenants/${tenantId}/subscriptions`)); }
    catch (cause) { setError(messageFor(cause, 'Tenant subscription and billing records could not be loaded.')); }
  }, []);

  const loadTenantFeatures = useCallback(async (tenantId: string) => {
    try { setTenantFeatures(await apiRequest<TenantFeatureAccess>(`/platform/tenants/${tenantId}/features`)); }
    catch (cause) { setError(messageFor(cause, 'Tenant modules and limits could not be loaded.')); }
  }, []);

  const loadTenantDomains = useCallback(async (tenantId: string) => {
    try { setTenantDomains(await apiRequest<TenantDomainRow[]>(`/platform/tenants/${tenantId}/domains`)); }
    catch (cause) { setError(messageFor(cause, 'Tenant domains could not be loaded.')); }
  }, []);

  const loadTenantBranches = useCallback(async (tenantId: string) => {
    try {
      const [branches, users] = await Promise.all([
        apiRequest<PageResult<TenantBranchRow>>(`/platform/tenants/${tenantId}/branches?pageSize=200`),
        apiRequest<PageResult<UserRow>>(`/platform/tenants/${tenantId}/users?pageSize=250&sort=firstName`),
      ]);
      setTenantBranches(branches.items);
      setTenantBranchUsers(users.items);
      setTenantBranchMemberSelections(Object.fromEntries(branches.items.map((branch) => [branch.id, branch.members.map(({ userId }) => userId)])));
    } catch (cause) { setError(messageFor(cause, 'Tenant branch records could not be loaded.')); }
  }, []);

  const loadTenantUsers = useCallback(async (tenantId: string, requestedPage = userPage) => {
    try {
      const directory = userFilter === 'admins' ? 'admins' : 'users';
      const [users, roles] = await Promise.all([
        apiRequest<PageResult<UserRow>>('/platform/tenants/' + tenantId + '/' + directory + '?' + new URLSearchParams({
          page: String(requestedPage), pageSize: '25', sort: 'firstName',
          ...(userSearch.trim() ? { search: userSearch.trim() } : {}),
          ...(userStatusFilter ? { status: userStatusFilter } : {}),
        }).toString()),
        apiRequest<RoleRow[]>('/platform/tenants/' + tenantId + '/roles'),
      ]);
      setTenantUsers(users);
      setTenantRoles(roles);
      setUserRoleSelections(Object.fromEntries(users.items.map((row) => [row.id, row.userRoles.map(({ role }) => role.id)])));
    } catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Tenant user records could not be loaded.'); }
  }, [userPage, userFilter, userSearch, userStatusFilter]);

  const loadBase = useCallback(async () => {
    const jobs: Array<Promise<unknown>> = [];
    if (activeView === 'overview' || activeView === 'plans') jobs.push(loadOverview());
    if (activeView === 'overview' || activeView === 'tenants') jobs.push(loadTenants());
    if (activeView === 'admins') jobs.push(loadSuperAdmins());
    if (activeView === 'plans' || activeView === 'provision' || activeView === 'tenant-details') jobs.push(loadPlans());
    if (activeView === 'tenant-details' && selectedTenant) {
      if (tenantDetailTab === 'users') jobs.push(loadTenantUsers(selectedTenant.id, userPage));
      if (tenantDetailTab === 'organization') jobs.push(loadTenantBranches(selectedTenant.id));
      if (tenantDetailTab === 'billing') jobs.push(loadTenantSubscriptions(selectedTenant.id));
      if (tenantDetailTab === 'modules') jobs.push(loadTenantFeatures(selectedTenant.id));
      if (tenantDetailTab === 'domains') jobs.push(loadTenantDomains(selectedTenant.id));
    }

    setLoading(true);
    setError('');
    try { await Promise.all(jobs); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : 'Platform records could not be loaded.'); }
    finally { setLoading(false); }
  }, [activeView, tenantDetailTab, selectedTenant, userPage, loadOverview, loadTenants, loadSuperAdmins, loadPlans, loadTenantUsers, loadTenantBranches, loadTenantSubscriptions, loadTenantFeatures, loadTenantDomains]);

  useEffect(() => {
    if (!user?.isPlatformAdmin) { setLoading(false); return; }
    const jobs: Array<Promise<unknown>> = [];
    if (activeView === 'overview' || activeView === 'plans') jobs.push(loadOverview());
    if (activeView === 'overview' || activeView === 'tenants') jobs.push(loadTenants());
    if (activeView === 'admins') jobs.push(loadSuperAdmins());
    if (activeView === 'plans' || activeView === 'provision' || activeView === 'tenant-details') jobs.push(loadPlans());
    setLoading(true);
    setError('');
    void Promise.all(jobs)
      .catch((cause) => setError(messageFor(cause, 'Platform records could not be loaded.')))
      .finally(() => setLoading(false));
  }, [user?.isPlatformAdmin, activeView, loadOverview, loadTenants, loadSuperAdmins, loadPlans]);
  useEffect(() => { if (activeView === 'tenant-details' && tenantDetailTab === 'users' && selectedTenant) void loadTenantUsers(selectedTenant.id, userPage); }, [activeView, tenantDetailTab, selectedTenant?.id, userPage, userFilter, userSearch, userStatusFilter, loadTenantUsers]);
  useEffect(() => { if (activeView === 'tenant-details' && tenantDetailTab === 'billing' && selectedTenant) void loadTenantSubscriptions(selectedTenant.id); }, [activeView, tenantDetailTab, selectedTenant?.id, loadTenantSubscriptions]);
  useEffect(() => { if (activeView === 'tenant-details' && tenantDetailTab === 'modules' && selectedTenant) void loadTenantFeatures(selectedTenant.id); }, [activeView, tenantDetailTab, selectedTenant?.id, loadTenantFeatures]);
  useEffect(() => { if (activeView === 'tenant-details' && tenantDetailTab === 'domains' && selectedTenant) void loadTenantDomains(selectedTenant.id); }, [activeView, tenantDetailTab, selectedTenant?.id, loadTenantDomains]);
  useEffect(() => { if (activeView === 'tenant-details' && tenantDetailTab === 'organization' && selectedTenant) void loadTenantBranches(selectedTenant.id); }, [activeView, tenantDetailTab, selectedTenant?.id, loadTenantBranches]);
  useEffect(() => {
    if (!tenantDetailsId || !user?.isPlatformAdmin) {
      if (activeView !== 'tenant-details') setSelectedTenant(null);
      return;
    }
    if (selectedTenant?.id === tenantDetailsId) return;
    let current = true;
    setTenantDetailTab(tenantDetailTabFromHash(window.location.hash) ?? 'overview');
    setTenantCategoryEdited(false);
    setTenantDetailsLoading(true);
    void apiRequest<TenantRow>('/platform/tenants/' + encodeURIComponent(tenantDetailsId))
      .then((result) => { if (current) setSelectedTenant(result); })
      .catch((cause) => { if (current) setError(messageFor(cause, 'Tenant details could not be loaded.')); })
      .finally(() => { if (current) setTenantDetailsLoading(false); });
    return () => { current = false; };
  }, [tenantDetailsId, user?.isPlatformAdmin, selectedTenant?.id, activeView]);

  async function runAction(action: () => Promise<void>, successMessage?: string) {
    setBusy(true); setError(''); setNotice('');
    try { await action(); if (successMessage) setNotice(successMessage); return true; }
    catch (cause) { setError(messageFor(cause, 'The requested administration change could not be saved.')); return false; }
    finally { setBusy(false); }
  }

  function navigateTo(view: PlatformView) {
    if (view === 'tenant-details') return;
    if (activeView === 'provision' && provisioningDirty && !window.confirm('Leave tenant setup? Your unsaved changes will be discarded.')) return;
    if (activeView === 'provision' && provisioningDirty) {
      setProvisioningDirty(false);
      window.dispatchEvent(new CustomEvent('wasl:provision-dirty', { detail: false }));
    }
    router.push(platformPathForView(view));
  }

  function selectTenantDetailTab(tab: TenantDetailTab) {
    setTenantDetailTab(tab);
    if (typeof window !== 'undefined' && activeView === 'tenant-details') window.history.replaceState(window.history.state, '', `${pathname}#${tab}`);
  }

  async function createTenant(payload: TenantProvisionPayload, idempotencyKey: string) {
    const created = await runAction(async () => {
      const created = await apiRequest<TenantRow & { tenantAdminEmail: string; tenantAdminStatus: 'INVITED'; tenantAdminInvitationExpiresAt: string }>('/platform/tenants', buildProvisionTenantRequest(payload, idempotencyKey));
      setNewTenant({ id: created.id, name: created.name, tenantHost: created.tenantHost, tenantAdminEmail: created.tenantAdminEmail, invitationExpiresAt: created.tenantAdminInvitationExpiresAt });
      setUserPage(1);
      await Promise.all([loadOverview(), loadTenants()]);
    }, 'The tenant workspace was provisioned and its Tenant Admin invitation was queued for email delivery.');
    return created;
  }

  async function selectTenant(tenant: TenantRow) {
    router.push('/platform/tenants/' + encodeURIComponent(tenant.id));
    setSelectedTenant(tenant);
    setTenantDetailTab('overview');
    setTenantUsers(null);
    setTenantSubscriptions([]);
    setTenantFeatures(null);
    setTenantDomains([]);
    setTenantBranches([]);
    setTenantCategoryEdited(false);
    setUserPage(1);
    setUserFilter('admins');
    setError('');
    try {
      const latest = await apiRequest<TenantRow>('/platform/tenants/' + tenant.id);
      setSelectedTenant(latest);
    } catch (cause) { setError(messageFor(cause, 'Tenant details could not be loaded.')); }
  }

  async function savePlan(payload: PlanPayload, key?: string) {
    await runAction(async () => {
      const method = key ? 'PATCH' : 'POST';
      const url = key ? `/platform/plans/${encodeURIComponent(key)}` : '/platform/plans';
      await apiRequest(url, { method, body: JSON.stringify(payload) });
      await loadPlans();
    }, key ? 'Plan was updated.' : 'Plan was created.');
  }

  async function createTenantSubscription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTenant) return;
    const form = new FormData(event.currentTarget);
    await runAction(async () => {
      await apiRequest(`/platform/tenants/${selectedTenant.id}/subscriptions`, { method: 'POST', body: JSON.stringify({ planId: field(form, 'planId'), billingInterval: field(form, 'billingInterval'), startTrial: form.get('startTrial') === 'on' }) });
      await Promise.all([loadTenantSubscriptions(selectedTenant.id), loadTenants(), loadOverview()]);
    }, 'Subscription was assigned and tenant entitlements were synchronized.');
  }

  async function updateSubscriptionStatus(event: FormEvent<HTMLFormElement>, subscriptionId: string) {
    event.preventDefault();
    if (!selectedTenant) return;
    const form = new FormData(event.currentTarget);
    await runAction(async () => {
      await apiRequest(`/platform/subscriptions/${subscriptionId}/status`, { method: 'PATCH', body: JSON.stringify({ status: field(form, 'status'), reason: field(form, 'reason') }) });
      await Promise.all([loadTenantSubscriptions(selectedTenant.id), loadTenants(), loadOverview()]);
    }, 'Subscription lifecycle and tenant access were updated.');
  }

  async function updateSubscriptionCancellation(event: FormEvent<HTMLFormElement>, subscriptionId: string) {
    event.preventDefault();
    if (!selectedTenant) return;
    const form = new FormData(event.currentTarget);
    await runAction(async () => {
      await apiRequest(`/platform/subscriptions/${subscriptionId}/cancellation`, { method: 'PATCH', body: JSON.stringify({
        cancelAtPeriodEnd: form.get('cancelAtPeriodEnd') === 'on',
        reason: field(form, 'reason'),
      }) });
      await Promise.all([loadTenantSubscriptions(selectedTenant.id), loadTenants(), loadOverview()]);
    }, 'Subscription cancellation schedule was updated.');
  }

  async function issueInvoice(event: FormEvent<HTMLFormElement>, subscriptionId: string) {
    event.preventDefault();
    if (!selectedTenant) return;
    await runAction(async () => {
      await apiRequest(`/platform/tenants/${selectedTenant.id}/subscriptions/${subscriptionId}/invoices`, { method: 'POST', body: JSON.stringify({}) });
      await loadTenantSubscriptions(selectedTenant.id);
    }, 'Invoice issued or existing outstanding invoice returned.');
  }

  async function recordManualPayment(event: FormEvent<HTMLFormElement>, invoiceId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (!selectedTenant) return;
    await runAction(async () => {
      await apiRequest(`/platform/invoices/${invoiceId}/payments`, { method: 'POST', body: JSON.stringify({
        amount: Number(field(values, 'amount')),
        providerPaymentId: nullableField(values, 'providerPaymentId'),
        idempotencyKey: crypto.randomUUID(),
      }) });
      form.reset();
      await Promise.all([loadTenantSubscriptions(selectedTenant.id), loadTenants(), loadOverview()]);
    }, 'Manually verified payment was recorded and audited.');
  }

  async function requestRefund(event: FormEvent<HTMLFormElement>, paymentId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    if (!selectedTenant) return;
    await runAction(async () => {
      await apiRequest(`/platform/payments/${paymentId}/refunds`, { method: 'POST', body: JSON.stringify({ amount: Number(field(values, 'amount')), reason: field(values, 'reason') }) });
      form.reset();
      await loadTenantSubscriptions(selectedTenant.id);
    }, 'Refund request recorded. Process it with the payment provider before marking it processed.');
  }

  async function updateRefundStatus(refundId: string, status: 'PROCESSED' | 'REJECTED', externalRefundId?: string | null) {
    if (!selectedTenant) return;
    await runAction(async () => {
      await apiRequest(`/platform/refunds/${refundId}/status`, { method: 'PATCH', body: JSON.stringify({ status, externalRefundId }) });
      await loadTenantSubscriptions(selectedTenant.id);
    }, status === 'PROCESSED' ? 'Refund marked processed with its provider reference.' : 'Refund request was rejected.');
  }

  async function updateTenantModuleOverride(event: FormEvent<HTMLFormElement>, moduleKey: string) {
    event.preventDefault();
    if (!selectedTenant) return;
    const values = new FormData(event.currentTarget);
    const setting = field(values, 'setting');
    await runAction(async () => {
      await apiRequest(`/platform/tenants/${selectedTenant.id}/modules/${encodeURIComponent(moduleKey)}`, { method: 'PUT', body: JSON.stringify({
        enabled: setting === 'INHERIT' ? null : setting === 'ENABLED',
        reason: field(values, 'reason'),
      }) });
      await Promise.all([loadTenantFeatures(selectedTenant.id), loadTenants()]);
    }, 'Tenant module access was updated and audited.');
  }

  async function updateTenantEntitlement(event: FormEvent<HTMLFormElement>, entitlementKey: string) {
    event.preventDefault();
    if (!selectedTenant) return;
    const values = new FormData(event.currentTarget);
    const mode = field(values, 'mode');
    const rawLimit = field(values, 'limitValue');
    if (mode === 'OVERRIDE' && rawLimit === '') { setError('Enter a custom entitlement limit or choose unlimited/inherit.'); return; }
    await runAction(async () => {
      await apiRequest(`/platform/tenants/${selectedTenant.id}/entitlements/${encodeURIComponent(entitlementKey)}`, { method: 'PUT', body: JSON.stringify({
        limitValue: rawLimit === '' ? null : Number(rawLimit),
        inherit: mode === 'INHERIT',
        reason: field(values, 'reason'),
      }) });
      await loadTenantFeatures(selectedTenant.id);
    }, 'Tenant feature limit was updated and audited.');
  }

  async function addTenantDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTenant) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    await runAction(async () => {
      await apiRequest<TenantDomainRow>(`/platform/tenants/${selectedTenant.id}/domains`, { method: 'POST', body: JSON.stringify({ domain: field(values, 'domain') }) });
      form.reset();
      await loadTenantDomains(selectedTenant.id);
    }, 'Domain registered. Publish its TXT ownership record, then verify it here.');
  }

  async function verifyTenantDomain(domain: TenantDomainRow) {
    if (!selectedTenant) return;
    await runAction(async () => {
      const result = await apiRequest<TenantDomainRow & { verified: boolean }>(`/platform/tenants/${selectedTenant.id}/domains/${domain.id}/verify`, { method: 'POST' });
      await loadTenantDomains(selectedTenant.id);
      if (result.verified) setNotice(`${domain.domain} is ownership verified. Configure your edge route and TLS certificate before directing customer traffic.`);
      else setNotice(`The TXT challenge for ${domain.domain} was not found yet. DNS changes can take time to propagate.`);
    });
  }

  async function rotateTenantDomainChallenge(domainId: string) {
    if (!selectedTenant) return;
    await runAction(async () => {
      await apiRequest<TenantDomainRow>(`/platform/tenants/${selectedTenant.id}/domains/${domainId}/challenge`, { method: 'POST' });
      await loadTenantDomains(selectedTenant.id);
    }, 'DNS challenge rotated. Publish the new TXT value before verification.');
  }

  async function makeTenantDomainPrimary(domain: TenantDomainRow) {
    if (!selectedTenant) return;
    await runAction(async () => {
      await apiRequest<TenantDomainRow>(`/platform/tenants/${selectedTenant.id}/domains/${domain.id}/primary`, { method: 'PUT' });
      await loadTenantDomains(selectedTenant.id);
    }, `${domain.domain} is now the tenant’s primary custom hostname.`);
  }

  async function removeTenantDomain(domain: TenantDomainRow) {
    if (!selectedTenant || !window.confirm(`Remove ${domain.domain} from ${selectedTenant.name}? Requests for it will stop resolving to this tenant.`)) return;
    await runAction(async () => {
      await apiRequest(`/platform/tenants/${selectedTenant.id}/domains/${domain.id}`, { method: 'DELETE' });
      await loadTenantDomains(selectedTenant.id);
    }, `${domain.domain} was removed.`);
  }

  async function copyDomainChallenge(domain: TenantDomainRow) {
    if (!domain.verificationRecordValue) return;
    try {
      await navigator.clipboard.writeText(`${domain.verificationRecordName}\tTXT\t${domain.verificationRecordValue}`);
      setNotice('DNS TXT record copied.');
    } catch {
      setError('Clipboard access was blocked. Copy the TXT record shown on the screen.');
    }
  }

  async function updateTenant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTenant) return;
    const values = new FormData(event.currentTarget);
    await runAction(async () => {
      const updated = await apiRequest<TenantRow>('/platform/tenants/' + selectedTenant.id, {
        method: 'PATCH',
        body: JSON.stringify({
          name: field(values, 'name'), organizationType: tenantCategoryEdited ? field(values, 'organizationType') : undefined, slug: field(values, 'slug').toLowerCase(), contactEmail: nullableField(values, 'contactEmail'),
          contactPhone: nullableField(values, 'contactPhone'), countryCode: nullableField(values, 'countryCode'),
        }),
      });
      setSelectedTenant(updated);
      setTenantCategoryEdited(false);
      await Promise.all([loadOverview(), loadTenants()]);
    }, 'Organization details were updated and audited.');
  }

  async function changeTenantStatus(tenant: TenantRow, status: TenantStatus) {
    if ((status === 'SUSPENDED' || status === 'ARCHIVED') && !window.confirm(`${status === 'ARCHIVED' ? 'Archive' : 'Suspend'} ${tenant.name}? This will change access for everyone in that workspace.`)) return;
    await runAction(async () => {
      const updated = await apiRequest<TenantRow>('/platform/tenants/' + tenant.id + '/status', { method: 'PATCH', body: JSON.stringify({ status }) });
      if (selectedTenant?.id === tenant.id) setSelectedTenant(updated);
      await Promise.all([loadOverview(), loadTenants()]);
    }, tenant.name + ' is now ' + enumLabel(status).toLowerCase() + '.');
  }

  async function createTenantAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTenant) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    await runAction(async () => {
      await apiRequest('/platform/tenants/' + selectedTenant.id + '/admins', {
        method: 'POST',
        body: JSON.stringify({ email: field(values, 'email'), phone: nullableField(values, 'phone'), firstName: field(values, 'firstName'), lastName: nullableField(values, 'lastName'), temporaryPassword: field(values, 'temporaryPassword') }),
      });
      form.reset();
      await Promise.all([loadTenantUsers(selectedTenant.id, userPage), loadTenants()]);
    }, 'Tenant Admin created. The account must change its temporary password at first sign-in.');
  }

  async function updateTenantUserProfile(event: FormEvent<HTMLFormElement>, userId: string) {
    event.preventDefault();
    if (!selectedTenant) return;
    const values = new FormData(event.currentTarget);
    await runAction(async () => {
      await apiRequest('/platform/tenants/' + selectedTenant.id + '/users/' + userId, {
        method: 'PATCH', body: JSON.stringify({ email: field(values, 'email'), firstName: field(values, 'firstName'), lastName: nullableField(values, 'lastName'), phone: nullableField(values, 'phone') }),
      });
      await loadTenantUsers(selectedTenant.id, userPage);
    }, 'Tenant user profile updated.');
  }

  async function updateTenantUserStatus(row: UserRow) {
    if (!selectedTenant) return;
    const status: UserStatus = row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    await runAction(async () => {
      await apiRequest('/platform/tenants/' + selectedTenant.id + '/users/' + row.id + '/status', { method: 'PATCH', body: JSON.stringify({ status }) });
      await Promise.all([loadTenantUsers(selectedTenant.id, userPage), loadTenants()]);
    }, row.firstName + ' ' + (status === 'ACTIVE' ? 'was activated.' : 'was deactivated.'));
  }

  async function assignTenantUserRoles(userId: string) {
    if (!selectedTenant) return;
    await runAction(async () => {
      await apiRequest('/platform/tenants/' + selectedTenant.id + '/users/' + userId + '/roles', { method: 'PATCH', body: JSON.stringify({ roleIds: userRoleSelections[userId] ?? [] }) });
      await loadTenantUsers(selectedTenant.id, userPage);
    }, 'Tenant user roles updated.');
  }

  async function resetTenantUserPassword(event: FormEvent<HTMLFormElement>, userId: string) {
    event.preventDefault();
    if (!selectedTenant) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    await runAction(async () => {
      await apiRequest('/platform/tenants/' + selectedTenant.id + '/users/' + userId + '/password-reset', { method: 'POST', body: JSON.stringify({ temporaryPassword: field(values, 'temporaryPassword') }) });
      form.reset();
      await loadTenantUsers(selectedTenant.id, userPage);
    }, 'A new temporary password was set. The user must replace it at sign-in.');
  }

  async function createSuperAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    await runAction(async () => {
      await apiRequest('/platform/super-admins', { method: 'POST', body: JSON.stringify({ email: field(values, 'email'), firstName: field(values, 'firstName'), lastName: nullableField(values, 'lastName') }) });
      form.reset();
      await Promise.all([loadSuperAdmins(), loadOverview()]);
    }, 'Super Admin invitation queued. The recipient sets their own password after verifying the email address.');
  }

  async function updateSuperAdminProfile(event: FormEvent<HTMLFormElement>, adminId: string) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await runAction(async () => {
      await apiRequest('/platform/super-admins/' + adminId, { method: 'PATCH', body: JSON.stringify({ email: field(values, 'email'), firstName: field(values, 'firstName'), lastName: nullableField(values, 'lastName') }) });
      await loadSuperAdmins();
    }, 'Super Admin profile updated.');
  }

  async function updateSuperAdminStatus(admin: SuperAdminRow) {
    const status: UserStatus = admin.status === 'ACTIVE' ? 'DISABLED' : admin.emailVerifiedAt ? 'ACTIVE' : 'DISABLED';
    await runAction(async () => {
      await apiRequest('/platform/super-admins/' + admin.id + '/status', { method: 'PATCH', body: JSON.stringify({ status }) });
      await Promise.all([loadSuperAdmins(), loadOverview()]);
    }, admin.firstName + ' ' + (status === 'ACTIVE' ? 'was activated.' : 'was deactivated.'));
  }

  async function createTenantBranch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTenant) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    await runAction(async () => {
      await apiRequest(`/platform/tenants/${selectedTenant.id}/branches`, { method: 'POST', body: JSON.stringify({
        code: field(values, 'code'), name: field(values, 'name'), managerId: nullableField(values, 'managerId'),
        phone: nullableField(values, 'phone'), email: nullableField(values, 'email'),
      }) });
      form.reset();
      await loadTenantBranches(selectedTenant.id);
    }, 'Branch created in the selected tenant.');
  }

  async function updateTenantBranch(event: FormEvent<HTMLFormElement>, branch: TenantBranchRow) {
    event.preventDefault();
    if (!selectedTenant) return;
    const values = new FormData(event.currentTarget);
    await runAction(async () => {
      await apiRequest(`/platform/tenants/${selectedTenant.id}/branches/${branch.id}`, { method: 'PATCH', body: JSON.stringify({
        code: field(values, 'code'), name: field(values, 'name'), status: field(values, 'status'),
        managerId: nullableField(values, 'managerId'), phone: nullableField(values, 'phone'), email: nullableField(values, 'email'),
      }) });
      await loadTenantBranches(selectedTenant.id);
      await loadTenants();
    }, `${branch.name} branch updated.`);
  }

  async function saveTenantBranchMembers(branch: TenantBranchRow) {
    if (!selectedTenant) return;
    await runAction(async () => {
      await apiRequest(`/platform/tenants/${selectedTenant.id}/branches/${branch.id}/users`, { method: 'PUT', body: JSON.stringify({ userIds: tenantBranchMemberSelections[branch.id] ?? [] }) });
      await loadTenantBranches(selectedTenant.id);
    }, `Membership updated for ${branch.name}.`);
  }

  async function resendSuperAdminInvitation(admin: SuperAdminRow) {
    await runAction(async () => {
      await apiRequest('/platform/super-admins/' + admin.id + '/invitation', { method: 'POST' });
      await loadSuperAdmins();
    }, 'A new single-use platform invitation was queued. The previous link is no longer valid.');
  }

  async function resetSuperAdminPassword(event: FormEvent<HTMLFormElement>, adminId: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    await runAction(async () => {
      await apiRequest('/platform/super-admins/' + adminId + '/password-reset', { method: 'POST', body: JSON.stringify({ temporaryPassword: field(values, 'temporaryPassword') }) });
      form.reset();
      await loadSuperAdmins();
    }, 'Super Admin password reset; prior refresh sessions were revoked.');
  }

  const visibleTenantUsers = useMemo(() => tenantUsers?.items ?? [], [tenantUsers]);
  if (tenant.kind !== 'platform' || !user?.isPlatformAdmin) return <main id="main-content" className="page-content"><section className="empty-state"><span className="empty-icon"><ShieldCheck /></span><h1>Super Admin access required</h1><p>The platform control plane is available only to a Super Admin account on the platform hostname.</p></section></main>;

  return <main id="main-content" className="page-content platform-page">
    <div className="page-heading platform-heading">
      <div>
        <p className="eyebrow">WASL PLATFORM · CONTROL PLANE</p>
        <h1>{activeView === 'overview' ? 'Platform overview' : activeView === 'tenants' ? 'Tenant workspaces' : activeView === 'tenant-details' ? selectedTenant?.name ?? 'Tenant details' : activeView === 'plans' ? 'Plans and billing' : activeView === 'admins' ? 'Platform administrators' : 'Provision a tenant'}</h1>
        <p className="muted">{activeView === 'overview' ? 'A clear view of workspace health, subscriptions, and platform access.' : activeView === 'tenants' ? 'Find an organization and manage its workspace settings and access.' : activeView === 'tenant-details' ? 'Review this workspace’s configuration, access, usage, and billing.' : activeView === 'plans' ? 'Configure the plans, modules, and limits available to organizations.' : activeView === 'admins' ? 'Manage the people who can access the Wasl platform control plane.' : 'Set up an organization and invite its first Tenant Admin.'}</p>
      </div>
      <div className="platform-heading-actions">
        <button className="button button-secondary" onClick={() => void loadBase()} disabled={loading || busy}><RefreshCw size={15} /> Refresh</button>
        {activeView === 'provision' || activeView === 'tenant-details' ? <button type="button" className="button button-secondary" onClick={() => navigateTo('tenants')}>Back to workspaces</button> : <button type="button" className="button button-primary" onClick={() => navigateTo('provision')}><Building2 size={15} /> Provision a tenant</button>}
      </div>
    </div>
    {error && <div className="notice notice-error" role="alert">{error}</div>}
    {notice && <div className="notice notice-success" role="status">{notice}</div>}
    {newTenant && <div className="notice notice-success platform-created-tenant" role="status"><span><strong>{newTenant.name} is ready.</strong> Tenant ID: <code>{newTenant.id}</code><br />Tenant Admin: {newTenant.tenantAdminEmail} · Invitation queued · Expires {formatIndianDateTime(new Date(newTenant.invitationExpiresAt))}<br />Workspace: <a href={tenantHref(newTenant.tenantHost)} target="_blank" rel="noopener noreferrer">{tenantHref(newTenant.tenantHost)} <ExternalLink size={13} /></a><br /><button type="button" className="text-button" onClick={() => { setSelectedTenant(null); router.push('/platform/tenants/' + encodeURIComponent(newTenant.id)); }}>Open tenant details</button></span><button type="button" className="text-button" onClick={() => setNewTenant(null)}>Dismiss</button></div>}

    {activeView === 'overview' && <div className="platform-overview-view">
      <section id="overview" className="platform-kpis" aria-label="Platform overview">
        <Kpi label="Workspaces" value={overview?.totalTenants} detail={`${formatIndianNumber(overview?.tenantStatuses.ACTIVE) ?? '—'} active`} icon={<Building2 size={18} />} />
        <Kpi label="In trial" value={overview?.tenantStatuses.TRIAL} detail="Organizations evaluating Wasl" icon={<Layers3 size={18} />} />
        <Kpi label="Platform admins" value={overview?.activeSuperAdmins} detail="Active control-plane operators" icon={<ShieldCheck size={18} />} />
        <Kpi label="Monthly recurring revenue" value={mrrHeadline(overview?.subscriptionsByCurrency)} detail={amountsByCurrency(overview?.subscriptionsByCurrency ?? [], 'monthlyRecurringRevenue') || 'No active subscriptions'} icon={<CreditCard size={18} />} />
      </section>
      <div className="platform-overview-grid">
        <section className="surface-panel platform-overview-panel">
          <div className="section-heading section-heading-panel"><div><p className="eyebrow">WORKSPACE DIRECTORY</p><h2>Recently created</h2><p>Your newest organization workspaces at a glance.</p></div><button type="button" className="text-button" onClick={() => navigateTo('tenants')}>View all workspaces <span aria-hidden="true">→</span></button></div>
          {loading ? <div className="compact-empty">Loading workspaces…</div> : tenants?.items.length ? <div className="platform-overview-tenant-list">{tenants.items.slice(0, 5).map((row) => <article className="platform-overview-tenant" key={row.id}>
            <span className="platform-overview-tenant-icon"><Building2 size={17} /></span>
            <button type="button" className="platform-overview-tenant-main" onClick={() => void selectTenant(row)}><strong>{row.name}</strong><small>{row.tenantHost} · {row.usage.activeUsers} active users</small></button>
            <span className={'status-pill ' + (row.status === 'ACTIVE' ? 'status-green' : row.status === 'SUSPENDED' || row.status === 'ARCHIVED' ? 'status-red' : 'status-amber')}>{enumLabel(row.status)}</span>
          </article>)}</div> : <div className="empty-state"><span className="empty-icon"><Building2 /></span><h3>No workspaces yet</h3><p>Create an organization workspace to get started.</p><button type="button" className="button button-primary button-small" onClick={() => navigateTo('provision')}>Provision a tenant</button></div>}
        </section>
        <aside className="platform-overview-side">
          <section className="surface-panel platform-overview-panel">
            <div className="section-heading section-heading-panel"><div><p className="eyebrow">PLATFORM OPERATIONS</p><h2>Needs attention</h2><p>Items to review across the platform.</p></div></div>
            <div className="platform-operations-list">
              <button type="button" onClick={() => navigateTo('plans')}><span className="platform-operation-icon"><ReceiptText size={16} /></span><span><strong>Open SaaS invoices</strong><small>{(overview?.invoicesByCurrency ?? []).reduce((total, row) => total + row.overdueCount, 0)} overdue · {amountsByCurrency(overview?.invoicesByCurrency ?? [], 'outstandingAmount') || 'No outstanding balance'}</small></span><b>{(overview?.invoicesByCurrency ?? []).reduce((total, row) => total + row.openCount, 0)}</b></button>
              <button type="button" onClick={() => navigateTo('plans')}><span className="platform-operation-icon"><RefreshCw size={16} /></span><span><strong>Refund requests</strong><small>{amountsByCurrency(overview?.requestedRefundsByCurrency ?? [], 'amount') || 'No pending refund amount'}</small></span><b>{(overview?.requestedRefundsByCurrency ?? []).reduce((total, row) => total + row.count, 0)}</b></button>
              <button type="button" onClick={() => navigateTo('tenants')}><span className="platform-operation-icon"><Globe2 size={16} /></span><span><strong>Custom domains</strong><small>{overview?.domains.pending ?? '—'} awaiting verification</small></span><b>{overview?.domains.verified ?? '—'}</b></button>
            </div>
            <div className="platform-overview-footer"><span>{overview?.activePlans ?? '—'} active plans</span><button type="button" className="text-button" onClick={() => navigateTo('plans')}>Manage catalog</button></div>
          </section>
          <section className="platform-quick-actions" aria-label="Quick actions"><p className="eyebrow">QUICK ACTIONS</p><button type="button" onClick={() => navigateTo('provision')}><Building2 size={16} /> Create a workspace</button><button type="button" onClick={() => navigateTo('admins')}><UsersRound size={16} /> Invite a platform admin</button></section>
        </aside>
      </div>
    </div>}

    {activeView === 'plans' && <section id="plans" className="surface-panel platform-plan-catalog">
      <div className="section-heading section-heading-panel"><div><p className="eyebrow">COMMERCIAL CATALOG</p><h2>Plans and entitlements</h2><p>Plan terms are frozen after a tenant subscribes. Create a new plan key to introduce changed prices or feature limits.</p></div><ShieldCheck size={18} /></div>
      <div className="platform-billing-glance" aria-label="Platform billing summary">
        <div><small>Open invoices</small><strong>{formatIndianNumber((overview?.invoicesByCurrency ?? []).reduce((total, row) => total + row.openCount, 0)) ?? '—'}</strong><span>{(overview?.invoicesByCurrency ?? []).reduce((total, row) => total + row.overdueCount, 0)} overdue</span></div>
        <div><small>Outstanding balance</small><strong>{amountsByCurrency(overview?.invoicesByCurrency ?? [], 'outstandingAmount') || formatIndianCurrency('0', 'INR')}</strong><span>Across platform subscriptions</span></div>
        <div><small>Refund requests</small><strong>{formatIndianNumber((overview?.requestedRefundsByCurrency ?? []).reduce((total, row) => total + row.count, 0)) ?? '—'}</strong><span>{amountsByCurrency(overview?.requestedRefundsByCurrency ?? [], 'amount') || 'No pending refund amount'}</span></div>
        <button type="button" className="button button-secondary button-small" onClick={() => navigateTo('tenants')}>Open tenant billing <span aria-hidden="true">→</span></button>
      </div>
      <PlanEditor onSave={(payload) => void savePlan(payload)} />
      {plans.length ? <div className="platform-plan-list">{plans.map((plan) => <article className="platform-plan-card" key={plan.id}>
        <div className="platform-user-heading"><div><strong>{plan.name}</strong><small>{plan.key} · {plan._count.subscriptions} subscription records</small></div><span className={'status-pill ' + (plan.active ? 'status-green' : 'status-amber')}>{plan.active ? 'Available' : 'Archived'}</span></div>
        <p>{plan.description || 'No description'}</p>
        <div className="platform-tenant-metadata"><span>{formatPlatformCurrency(plan.monthlyPrice, plan.currency)} / month</span><span>{formatPlatformCurrency(plan.yearlyPrice, plan.currency)} / year</span><span>{plan.trialDays} trial days</span></div>
        {plan.currency !== 'INR' && <small className="platform-currency-review">This plan needs review before it can be managed in INR. Create a new INR plan; existing amounts have not been converted.</small>}
        <small>{plan.modules.filter(({ enabled }) => enabled).map(({ moduleKey }) => PLATFORM_MODULE_LABELS[moduleKey as keyof typeof PLATFORM_MODULE_LABELS] ?? moduleKey).join(' · ') || 'No modules'} · {plan.entitlements.length} limits/features</small>
        <details className="platform-user-edit"><summary>Edit plan</summary><PlanEditor plan={plan} onSave={(payload) => void savePlan(payload, plan.id)} /></details>
      </article>)}</div> : <p className="empty-inline">No plan catalog records are available.</p>}
    </section>}

    {(activeView === 'tenants' || activeView === 'provision') && <div className="platform-workspace-view">
      {activeView === 'provision' && <section id="provision" className="surface-panel platform-create-panel">
        <div className="section-heading section-heading-panel"><div><p className="eyebrow">NEW WORKSPACE</p><h2>Organization setup</h2><p>Set up the organization, plan, regional defaults, and first Tenant Admin. Wasl will generate and check the workspace address.</p></div><Building2 size={18} /></div>
        <ProvisionTenantWizard plans={plans} busy={busy} onDirtyChange={setProvisioningDirty} onProvision={createTenant} />
      </section>}

      {activeView === 'tenants' && <section id="tenants" className="surface-panel platform-directory-panel">
        <div className="section-heading section-heading-panel"><div><h2>Tenant directory</h2><p>{formatIndianNumber(tenants?.pagination.total) ?? '—'} tenant workspaces</p></div><Building2 size={18} /></div>
        <div className="platform-filter-grid">
          <label className="search-box"><Search size={16} /><input aria-label="Search tenants" value={tenantSearch} onChange={(event) => { setPage(1); setTenantSearch(event.currentTarget.value); }} placeholder="Name, subdomain, contact" /></label>
          <select aria-label="Filter by tenant status" value={tenantStatusFilter} onChange={(event) => { setPage(1); setTenantStatusFilter(event.currentTarget.value); }}><option value="">All access states</option>{TENANT_STATUSES.map((status) => <option key={status} value={status}>{enumLabel(status)}</option>)}</select>
          <select aria-label="Filter by subscription status" value={subscriptionFilter} onChange={(event) => { setPage(1); setSubscriptionFilter(event.currentTarget.value); }}><option value="">All subscriptions</option>{SUBSCRIPTION_STATUSES.map((status) => <option key={status} value={status}>{enumLabel(status)}</option>)}</select>
        </div>
        {loading ? <div className="compact-empty">Loading tenant records…</div> : tenants?.items.length ? <div className="platform-tenant-list">{tenants.items.map((tenant) => <TenantCard key={tenant.id} tenant={tenant} selected={selectedTenant?.id === tenant.id} onSelect={() => void selectTenant(tenant)} onStatus={(status) => void changeTenantStatus(tenant, status)} />)}</div> : <div className="empty-state"><span className="empty-icon"><Building2 /></span><h3>No tenant workspaces found</h3><p>Adjust the search or filters, or provision a workspace.</p></div>}
        {tenants && <div className="table-footer platform-pagination"><span>Page {tenants.pagination.page} of {Math.max(tenants.pagination.totalPages, 1)}</span><div><button className="button button-secondary button-small" disabled={page <= 1 || busy} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><button className="button button-secondary button-small" disabled={page >= tenants.pagination.totalPages || busy} onClick={() => setPage((value) => value + 1)}>Next</button></div></div>}
      </section>}
    </div>}

    {activeView === 'tenant-details' && !selectedTenant && <section className="surface-panel platform-tenant-detail"><div className="compact-empty" role="status">{tenantDetailsLoading ? 'Loading tenant details…' : error || 'Tenant workspace not found.'}</div></section>}
    {activeView === 'tenant-details' && selectedTenant && <section id="tenant-details" className="surface-panel platform-tenant-detail">
      <div className="section-heading section-heading-panel"><div><p className="eyebrow">TENANT OPERATIONS</p><h2>{selectedTenant.name}</h2><p>{selectedTenant.tenantHost && <a className="text-link" href={tenantHref(selectedTenant.tenantHost)} target="_blank" rel="noopener noreferrer">{tenantHref(selectedTenant.tenantHost)} <ExternalLink size={13} /></a>}</p></div><button className="text-button" onClick={() => { setSelectedTenant(null); navigateTo('tenants'); }}>Back to tenant directory</button></div>
      <nav className="platform-detail-tabs" aria-label="Tenant details sections" role="tablist">
        {TENANT_DETAIL_TABS.map(([key, label], index) => <button key={key} type="button" role="tab" id={`tenant-detail-tab-${key}`} aria-selected={tenantDetailTab === key} aria-controls={`tenant-detail-${key}`} tabIndex={tenantDetailTab === key ? 0 : -1} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? TENANT_DETAIL_TABS.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + TENANT_DETAIL_TABS.length) % TENANT_DETAIL_TABS.length;
          const nextTab = TENANT_DETAIL_TABS[nextIndex]![0];
          selectTenantDetailTab(nextTab);
          document.getElementById(`tenant-detail-tab-${nextTab}`)?.focus();
        }} onClick={() => selectTenantDetailTab(key)}>{label}</button>)}
      </nav>
      <div id="tenant-detail-overview" role="tabpanel" aria-labelledby="tenant-detail-tab-overview" hidden={tenantDetailTab !== 'overview'} className="platform-usage-grid">
        <Usage label="Active Tenant Admins" value={selectedTenant.usage.activeTenantAdmins} />
        <Usage label="Users" value={selectedTenant.usage.activeUsers + ' / ' + selectedTenant.usage.totalUsers + ' active'} />
        <Usage label="Branches" value={selectedTenant.usage.branches} />
        <Usage label="Departments and groups" value={selectedTenant.usage.organizationUnits} />
        {selectedTenant.enabledModules.includes('PAYMENTS') && <Usage label="Recorded payments" value={selectedTenant.usage.recordedPayments ?? 0} />}
        <Usage label="Latest user sign-in" value={selectedTenant.usage.latestSignInAt ? formatIndianDateTime(new Date(selectedTenant.usage.latestSignInAt)) : 'No sign-ins'} />
      </div>
      <section id="tenant-detail-organization" role="tabpanel" aria-labelledby="tenant-detail-tab-organization" hidden={tenantDetailTab !== 'organization'} className="platform-subpanel platform-branch-management"><div className="section-heading section-heading-panel"><div><h3>Branch management</h3><p>These actions are scoped to {selectedTenant.name} and appear in its audit log.</p></div></div>
        <form className="platform-form" onSubmit={(event) => void createTenantBranch(event)}><div className="platform-form-grid"><label>Branch code<input name="code" required maxLength={48} /></label><label>Branch name<input name="name" required maxLength={160} /></label><label>Branch manager<select name="managerId" defaultValue=""><option value="">Unassigned</option>{tenantBranchUsers.filter((row) => row.status === 'ACTIVE').map((row) => <option key={row.id} value={row.id}>{row.firstName} {row.lastName ?? ''} · {row.email}</option>)}</select></label><label>Email<input name="email" type="email" /></label><label>Phone<input name="phone" maxLength={32} /></label></div><button className="button button-primary button-small" disabled={busy}>Create branch</button></form>
        {tenantBranches.length ? <div className="platform-tenant-list">{tenantBranches.map((branch) => <article className="platform-tenant-card" key={branch.id}><div className="platform-tenant-heading"><div><strong>{branch.name}</strong><small>{branch.code} · {branch.memberCount} members · {branch.manager?.email ?? 'No manager'}</small></div><span className={'status-pill ' + (branch.status === 'ACTIVE' ? 'status-green' : branch.status === 'ARCHIVED' ? 'status-red' : 'status-amber')}>{enumLabel(branch.status)}</span></div>
          <details className="platform-user-edit"><summary>Edit branch and membership</summary><form className="platform-form" onSubmit={(event) => void updateTenantBranch(event, branch)}><div className="platform-form-grid"><label>Code<input name="code" required maxLength={48} defaultValue={branch.code} /></label><label>Name<input name="name" required maxLength={160} defaultValue={branch.name} /></label><label>Status<select name="status" defaultValue={branch.status}>{['ACTIVE', 'INACTIVE', 'ARCHIVED'].map((status) => <option key={status} value={status}>{enumLabel(status)}</option>)}</select></label><label>Branch manager<select name="managerId" defaultValue={branch.managerId ?? ''}><option value="">Unassigned</option>{tenantBranchUsers.filter((row) => row.status === 'ACTIVE').map((row) => <option key={row.id} value={row.id}>{row.firstName} {row.lastName ?? ''} · {row.email}</option>)}</select></label><label>Email<input name="email" type="email" defaultValue={branch.email ?? ''} /></label><label>Phone<input name="phone" maxLength={32} defaultValue={branch.phone ?? ''} /></label></div><button className="button button-secondary button-small" disabled={busy}>Save branch</button></form>
            {branch.status === 'ACTIVE' && <div className="platform-form"><label>Branch members<select multiple size={Math.min(Math.max(tenantBranchUsers.length, 3), 8)} aria-label={`Members of ${branch.name}`} value={tenantBranchMemberSelections[branch.id] ?? []} onChange={(event) => setTenantBranchMemberSelections((current) => ({ ...current, [branch.id]: [...event.currentTarget.selectedOptions].map((option) => option.value) }))}>{tenantBranchUsers.filter((row) => row.status === 'ACTIVE').map((row) => <option key={row.id} value={row.id}>{row.firstName} {row.lastName ?? ''} · {row.email}</option>)}</select></label><button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => void saveTenantBranchMembers(branch)}>Save membership</button></div>}
          </details></article>)}</div> : <p className="empty-inline">No branches are configured for this tenant.</p>}
      </section>
      <div className="platform-detail-grid">
        <section className="platform-subpanel" hidden={tenantDetailTab !== 'organization'}><div className="section-heading section-heading-panel"><div><h3>Tenant profile</h3><p>Organization identity and contact information.</p></div></div>
          <form className="platform-form" onSubmit={updateTenant} key={selectedTenant.updatedAt ?? selectedTenant.id}>
            <div className="platform-form-grid">
              <label>Organization name<input name="name" required defaultValue={selectedTenant.name} /></label>
              <label>Organisation category<input name="organizationType" maxLength={80} defaultValue={selectedTenant.organizationType} onChange={() => setTenantCategoryEdited(true)} /><small>Known category keys use shared setup guidance. Custom category names remain supported.</small></label>
              <label>Subdomain slug<input name="slug" required pattern="[a-z0-9][a-z0-9-]*" maxLength={63} defaultValue={selectedTenant.slug} /><small>Changing it changes the workspace URL.</small></label>
              <label>Contact email<input name="contactEmail" type="email" defaultValue={selectedTenant.contactEmail ?? ''} /></label>
              <label>Contact phone<input name="contactPhone" defaultValue={selectedTenant.contactPhone ?? ''} /></label>
              <label>Country code<input name="countryCode" maxLength={2} defaultValue={selectedTenant.countryCode ?? ''} /></label>
            </div>
            <button className="button button-primary button-small" disabled={busy}>Save tenant details</button>
          </form>
        </section>
        <section id="tenant-detail-users" role="tabpanel" aria-labelledby="tenant-detail-tab-users" className="platform-subpanel" hidden={tenantDetailTab !== 'users'}><div className="section-heading section-heading-panel"><div><h3>Tenant users and administrators</h3><p>All tenant data actions run inside this tenant’s server-side scope.</p></div><UsersRound size={18} /></div>
          <div className="platform-user-toolbar"><div className="segmented-filter"><button className={userFilter === 'admins' ? 'selected' : ''} onClick={() => { setUserPage(1); setUserFilter('admins'); }}>Tenant Admins</button><button className={userFilter === 'all' ? 'selected' : ''} onClick={() => { setUserPage(1); setUserFilter('all'); }}>All users</button></div><details className="create-menu"><summary className="button button-primary button-small">Add Tenant Admin</summary><form className="popover-form" onSubmit={createTenantAdmin}><strong>Create a tenant administrator</strong><label>First name<input name="firstName" required /></label><label>Last name<input name="lastName" /></label><label>Email<input name="email" type="email" required /></label><label>Phone<input name="phone" /></label><label>Temporary password<input name="temporaryPassword" type="password" required minLength={12} autoComplete="new-password" /></label><button className="button button-primary button-wide" disabled={busy}>Create admin</button></form></details></div>
          <div className="platform-filter-grid"><label className="search-box"><Search size={16} /><input aria-label="Search tenant users" value={userSearch} onChange={(event) => { setUserPage(1); setUserSearch(event.currentTarget.value); }} placeholder="Search name, email, or phone" /></label><select aria-label="Filter tenant users by status" value={userStatusFilter} onChange={(event) => { setUserPage(1); setUserStatusFilter(event.currentTarget.value); }}><option value="">All user statuses</option>{USER_STATUSES.map((status) => <option key={status} value={status}>{enumLabel(status)}</option>)}</select></div>
          {tenantUsers?.items.length ? <div className="platform-user-list">{visibleTenantUsers.map((row) => <article className="platform-user-card" key={row.id}>
            <div className="platform-user-heading"><div><strong>{row.firstName} {row.lastName ?? ''}</strong><small>{row.email}{row.mustChangePassword ? ' · password change required' : ''}</small></div><span className={'status-pill ' + (row.status === 'ACTIVE' ? 'status-green' : row.status === 'SUSPENDED' || row.status === 'DISABLED' ? 'status-red' : 'status-amber')}>{enumLabel(row.status)}</span></div>
            <p className="platform-user-roles">{row.userRoles.map(({ role }) => role.name).join(', ') || 'No assigned role'} · Last sign-in {row.lastLoginAt ? formatIndianDate(new Date(row.lastLoginAt)) : 'never'}</p>
            <div className="platform-user-actions"><select multiple aria-label={'Roles for ' + row.email} size={Math.min(Math.max(tenantRoles.length, 2), 4)} value={userRoleSelections[row.id] ?? []} onChange={(event) => setUserRoleSelections((current) => ({ ...current, [row.id]: [...event.currentTarget.selectedOptions].map((option) => option.value) }))}>{tenantRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select><button className="button button-secondary button-small" onClick={() => void assignTenantUserRoles(row.id)} disabled={busy}>Save roles</button><button className="button button-secondary button-small" onClick={() => void updateTenantUserStatus(row)} disabled={busy}>{row.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button></div>
            <details className="platform-user-edit"><summary>Edit profile or reset password</summary><div className="platform-edit-grid"><form className="platform-form" onSubmit={(event) => void updateTenantUserProfile(event, row.id)}><label>First name<input name="firstName" required defaultValue={row.firstName} /></label><label>Last name<input name="lastName" defaultValue={row.lastName ?? ''} /></label><label>Email<input name="email" type="email" required defaultValue={row.email} /></label><label>Phone<input name="phone" defaultValue={row.phone ?? ''} /></label><button className="button button-secondary button-small" disabled={busy}>Save profile</button></form><form className="platform-form" onSubmit={(event) => void resetTenantUserPassword(event, row.id)}><label>Temporary password<input name="temporaryPassword" type="password" required minLength={12} autoComplete="new-password" /></label><button className="button button-secondary button-small" disabled={busy}>Reset password</button></form></div></details>
          </article>)}</div> : <div className="empty-inline">No users are listed on this page.</div>}
          {tenantUsers && <div className="table-footer platform-pagination"><span>Page {tenantUsers.pagination.page} of {Math.max(tenantUsers.pagination.totalPages, 1)}</span><div><button className="button button-secondary button-small" disabled={userPage <= 1} onClick={() => setUserPage((value) => Math.max(1, value - 1))}>Previous</button><button className="button button-secondary button-small" disabled={userPage >= tenantUsers.pagination.totalPages} onClick={() => setUserPage((value) => value + 1)}>Next</button></div></div>}
        </section>
      </div>
      <section id="tenant-detail-domains" role="tabpanel" aria-labelledby="tenant-detail-tab-domains" hidden={tenantDetailTab !== 'domains'} className="surface-panel platform-domains-panel">
        <div className="section-heading section-heading-panel"><div><p className="eyebrow">HOSTNAME MANAGEMENT</p><h3>Custom domains</h3><p>Ownership is checked with DNS TXT. Verification enables tenant host resolution; your edge proxy and TLS certificate must also be configured.</p></div></div>
        <form className="platform-domain-add" onSubmit={(event) => void addTenantDomain(event)}>
          <label>Tenant domain<input name="domain" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} required minLength={4} maxLength={253} placeholder="portal.example.com" /></label>
          <button className="button button-primary button-small" disabled={busy}>Register domain</button>
        </form>
        {tenantDomains.length ? <div className="platform-domain-list">{tenantDomains.map((domain) => <article className="platform-domain-card" key={domain.id}>
          <div className="platform-domain-heading"><div><strong>{domain.domain}</strong><small>Added {formatIndianDate(new Date(domain.createdAt))}</small></div><div className="platform-domain-badges"><span className={'status-pill ' + (domain.verifiedAt ? 'status-green' : 'status-amber')}>{domain.verifiedAt ? 'DNS verified' : 'Pending DNS verification'}</span>{domain.isPrimary && <span className="status-pill status-blue">Primary</span>}</div></div>
          {!domain.verifiedAt && <div className="platform-domain-challenge"><p>Add this DNS record at your provider, then verify after it propagates:</p><code>{domain.verificationRecordName} · TXT · {domain.verificationRecordValue ?? 'Challenge not generated'}</code><div className="platform-user-actions">{domain.verificationRecordValue && <button type="button" className="button button-secondary button-small" onClick={() => void copyDomainChallenge(domain)}>Copy TXT record</button>}<button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => void verifyTenantDomain(domain)}>Verify ownership</button>{!domain.verificationRecordValue && <button type="button" className="text-button" disabled={busy} onClick={() => void rotateTenantDomainChallenge(domain.id)}>Generate DNS challenge</button>}{domain.verificationRecordValue && <button type="button" className="text-button" disabled={busy} onClick={() => void rotateTenantDomainChallenge(domain.id)}>Rotate challenge</button>}</div></div>}
          {domain.verifiedAt && <p className="platform-domain-verified">Verified {formatIndianDateTime(new Date(domain.verifiedAt))}. Confirm the web and API edge route and TLS certificate before using this host.</p>}
          <div className="platform-user-actions">{domain.verifiedAt && !domain.isPrimary && <button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => void makeTenantDomainPrimary(domain)}>Make primary</button>}<button type="button" className="text-button platform-archive-action" disabled={busy} onClick={() => void removeTenantDomain(domain)}>Remove domain</button></div>
        </article>)}</div> : <p className="empty-inline">No custom domains are registered for this tenant.</p>}
      </section>
      <section id="tenant-detail-modules" role="tabpanel" aria-labelledby="tenant-detail-tab-modules" hidden={tenantDetailTab !== 'modules'} className="surface-panel platform-features-panel">
        <div className="section-heading section-heading-panel"><div><p className="eyebrow">PLAN ACCESS</p><h3>Modules, features and limits</h3><p>{tenantFeatures?.plan ? `Base plan: ${tenantFeatures.plan.name}. Overrides take effect immediately and are audited.` : 'No current plan is assigned. Module access uses the saved tenant projection.'}</p></div><ShieldCheck size={18} /></div>
        {tenantFeatures ? <div className="platform-feature-layout">
          <div><h4>Modules</h4><div className="platform-feature-list">{tenantFeatures.modules.map((module) => { const isCore = CORE_TENANT_MODULES.includes(module.moduleKey as (typeof CORE_TENANT_MODULES)[number]); return <form className="platform-feature-row" key={module.moduleKey} onSubmit={(event) => void updateTenantModuleOverride(event, module.moduleKey)}>
            <div><strong>{PLATFORM_MODULE_LABELS[module.moduleKey as keyof typeof PLATFORM_MODULE_LABELS] ?? module.moduleKey}</strong><small>{isCore ? 'Required core workspace module; always enabled.' : module.override ? `Override: ${module.override.reason ?? 'No reason recorded'}` : `Plan default: ${module.planEnabled ? 'enabled' : 'disabled'}`}</small></div>
            <label>Access<select name="setting" disabled={busy || isCore} defaultValue={isCore ? 'ENABLED' : module.override ? module.enabled ? 'ENABLED' : 'DISABLED' : 'INHERIT'}><option value="INHERIT">Inherit plan</option><option value="ENABLED">Enabled override</option><option value="DISABLED">Disabled override</option></select></label>
            <label>Reason<input name="reason" required minLength={5} maxLength={500} disabled={busy || isCore} defaultValue={module.override?.reason ?? ''} placeholder="Support exception or customer agreement" /></label>
            <button className="button button-secondary button-small" disabled={busy || isCore}>Save</button>
            <span className={'status-pill ' + (module.enabled ? 'status-green' : 'status-amber')}>{module.enabled ? 'Enabled' : 'Disabled'}</span>
          </form>})}</div></div>
          <div><h4>Entitlement limits</h4>{tenantFeatures.entitlements.length ? <div className="platform-feature-list">{tenantFeatures.entitlements.map((entitlement) => <form className="platform-feature-row" key={entitlement.entitlementKey} onSubmit={(event) => void updateTenantEntitlement(event, entitlement.entitlementKey)}>
            <div><strong>{enumLabel(entitlement.entitlementKey)}</strong><small>Plan limit: {entitlement.planLimit ?? 'Unlimited'}{entitlement.usage === null ? '' : ` · Current usage: ${entitlement.usage}`}{entitlement.override ? ` · Override: ${entitlement.override.reason}` : ''}</small></div>
            <label>Limit mode<select name="mode" defaultValue={entitlement.override ? entitlement.override.limitValue === null ? 'UNLIMITED' : 'OVERRIDE' : 'INHERIT'}><option value="INHERIT">Inherit plan</option><option value="OVERRIDE">Custom limit</option><option value="UNLIMITED">Unlimited</option></select></label>
            <label>Custom limit<input name="limitValue" type="number" min={0} max={2147483647} step={1} defaultValue={entitlement.limit ?? ''} /></label>
            <label>Reason<input name="reason" required minLength={5} maxLength={500} defaultValue={entitlement.override?.reason ?? ''} placeholder="Support exception or customer agreement" /></label>
            <button className="button button-secondary button-small" disabled={busy}>Save</button>
            <span className="status-pill status-blue">{entitlement.limit === null ? 'Unlimited' : `${entitlement.usage ?? '—'} / ${entitlement.limit}`}</span>
          </form>)}</div> : <p className="empty-inline">The current plan has no numeric limits or tenant overrides.</p>}</div>
        </div> : <p className="empty-inline">Loading tenant features…</p>}
      </section>
      <section id="tenant-detail-billing" role="tabpanel" aria-labelledby="tenant-detail-tab-billing" hidden={tenantDetailTab !== 'billing'} className="surface-panel platform-subscription-panel">
        <div className="section-heading section-heading-panel"><div><p className="eyebrow">SUBSCRIPTION LIFECYCLE</p><h3>Plans, access state, invoices and payments</h3><p>Plan changes retain subscription history and synchronize tenant module entitlements.</p></div></div>
        <form className="platform-filter-grid" onSubmit={(event) => void createTenantSubscription(event)}><label>Assign or change plan<select name="planId" required defaultValue=""><option value="">Choose an active plan</option>{plans.filter((plan) => plan.active).map((plan) => <option key={plan.id} value={plan.id}>{plan.name} · {formatPlatformCurrency(plan.monthlyPrice, plan.currency)}/month</option>)}</select></label><label>Billing interval<select name="billingInterval" defaultValue="MONTHLY"><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option><option value="MANUAL">Manual</option></select></label><label className="platform-checkbox-label"><input name="startTrial" type="checkbox" /> Start a new plan trial</label><button className="button button-primary button-small" disabled={busy}>Apply plan</button></form>
        {tenantSubscriptions.length ? <div className="platform-subscription-list">{tenantSubscriptions.map((subscription) => <article className="platform-subscription-card" key={subscription.id}>
          <div className="platform-user-heading"><div><strong>{subscription.plan.name} · {subscription.billingInterval.toLowerCase()}</strong><small>{formatPlatformCurrency(subscription.amount, subscription.currency)} · Started {formatIndianDate(new Date(subscription.currentPeriodStart ?? subscription.trialEndsAt ?? Date.now()))}</small></div><span className={'status-pill ' + (subscription.status === 'ACTIVE' ? 'status-green' : subscription.status === 'PAST_DUE' || subscription.status === 'PAUSED' ? 'status-amber' : 'status-red')}>{enumLabel(subscription.status)}{subscription.isCurrent ? ' · Current' : ' · History'}</span></div>
          <p>{subscription.status === 'TRIAL' && subscription.trialEndsAt ? `Trial ends ${formatIndianDate(new Date(subscription.trialEndsAt))}` : subscription.currentPeriodEnd ? `Period ends ${formatIndianDate(new Date(subscription.currentPeriodEnd))}` : 'No automatic renewal date'}{subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd ? ` · Cancellation scheduled for ${formatIndianDate(new Date(subscription.currentPeriodEnd))}` : ''}{subscription.cancelledAt ? ` · Cancelled ${formatIndianDate(new Date(subscription.cancelledAt))}` : ''}</p>
          {subscription.isCurrent && <form className="platform-filter-grid" onSubmit={(event) => void updateSubscriptionStatus(event, subscription.id)}><label>Change lifecycle state<select name="status" defaultValue=""><option value="">Choose an allowed transition</option>{allowedSubscriptionTransitions(subscription.status).map((status) => <option key={status} value={status}>{enumLabel(status)}</option>)}</select></label><label>Reason<input name="reason" minLength={5} maxLength={500} required placeholder="Renewal received, payment overdue…" /></label><button className="button button-secondary button-small" disabled={busy}>Update lifecycle</button></form>}
          {subscription.isCurrent && subscription.currentPeriodEnd && ['TRIAL', 'ACTIVE', 'PAST_DUE'].includes(subscription.status) && <form className="platform-filter-grid" onSubmit={(event) => void updateSubscriptionCancellation(event, subscription.id)}><label className="platform-checkbox-label"><input name="cancelAtPeriodEnd" type="checkbox" defaultChecked={subscription.cancelAtPeriodEnd} /> Cancel at period end</label><label>Reason<input name="reason" minLength={5} maxLength={500} required placeholder="Customer requested cancellation…" /></label><button className="button button-secondary button-small" disabled={busy}>Save cancellation schedule</button></form>}
          {subscription.isCurrent && <form className="platform-filter-grid" onSubmit={(event) => void issueInvoice(event, subscription.id)}><p className="empty-inline">Issue the next subscription invoice. Existing outstanding invoices are reused.</p><button className="button button-secondary button-small" disabled={busy}>Issue invoice</button></form>}
          {subscription.invoices.map((invoice) => <div className="platform-invoice-row" key={invoice.id}>
            <strong>{invoice.invoiceNumber}</strong><span>{formatPlatformCurrency(invoice.total, invoice.currency)} · {invoice.status} · Due {formatIndianDate(new Date(invoice.dueAt))}</span>
            {['OPEN', 'PARTIALLY_PAID', 'PAST_DUE'].includes(invoice.status) && <form className="platform-inline-finance-form" onSubmit={(event) => void recordManualPayment(event, invoice.id)}><strong>Record a manually verified payment</strong><label>Amount<input name="amount" aria-label={`Amount paid for ${invoice.invoiceNumber}`} type="number" min="0.0001" step="0.0001" max={invoice.total} required /></label><label>Provider reference<input name="providerPaymentId" maxLength={200} placeholder="Receipt / transfer reference" /></label><button className="button button-secondary button-small" disabled={busy}>Record payment</button><small>Reconcile the funds outside this system first. This action does not charge a card or contact a payment provider.</small></form>}
            {invoice.payments.map((payment) => <div className="platform-payment-detail" key={payment.id}><small>{payment.provider}: {payment.status} · {formatPlatformCurrency(payment.amount, payment.currency)}{payment.providerPaymentId ? ` · Ref ${payment.providerPaymentId}` : ''}{payment.refunds.length ? ` · ${payment.refunds.length} refund request(s)` : ''}</small>
              {['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(payment.status) && <details className="platform-refund-tools"><summary>Request refund</summary><form className="platform-inline-finance-form" onSubmit={(event) => void requestRefund(event, payment.id)}><label>Amount<input name="amount" type="number" min="0.0001" step="0.0001" max={payment.amount} required /></label><label>Reason<input name="reason" minLength={5} maxLength={1000} required /></label><button className="button button-secondary button-small" disabled={busy}>Request refund</button></form></details>}
              {payment.refunds.map((refund) => <div className="platform-refund-row" key={refund.id}><small>Refund {formatPlatformCurrency(refund.amount, refund.currency)} · {refund.status} · {refund.reason}{refund.externalRefundId ? ` · Provider ref ${refund.externalRefundId}` : ''}</small>{refund.status === 'REQUESTED' && <div className="platform-user-actions"><button className="button button-secondary button-small" disabled={busy} onClick={() => { const externalRefundId = window.prompt('Enter the payment provider refund reference after processing the refund:'); if (externalRefundId?.trim()) void updateRefundStatus(refund.id, 'PROCESSED', externalRefundId.trim()); }}>Mark processed</button><button className="text-button" disabled={busy} onClick={() => void updateRefundStatus(refund.id, 'REJECTED')}>Reject request</button></div>}</div>)}
            </div>)}
          </div>)}
        </article>)}</div> : <p className="empty-inline">No subscription history is recorded.</p>}
      </section>
    </section>}

    {activeView === 'admins' && <section id="platform-admins" className="surface-panel platform-super-admins"><div className="section-heading section-heading-panel"><div><p className="eyebrow">PLATFORM IDENTITY SCOPE</p><h2>Super Admin accounts</h2><p>Platform operators use a reserved identity scope that is separate from every tenant directory.</p></div><ShieldCheck size={18} /></div>
      <div className="platform-super-admin-layout"><form className="platform-form platform-super-admin-form" onSubmit={createSuperAdmin}><h3>Invite a Super Admin</h3><div className="platform-form-grid"><label>First name<input name="firstName" required /></label><label>Last name<input name="lastName" /></label><label>Email<input name="email" type="email" required /></label></div><p className="muted">An invitation is sent to the platform sign-in hostname. It expires after 48 hours and the recipient sets their own password.</p><button className="button button-primary button-small" disabled={busy}>Send invitation</button></form>
        <div><div className="platform-filter-grid"><label className="search-box"><Search size={16} /><input aria-label="Search Super Admin accounts" value={superAdminSearch} onChange={(event) => { setSuperAdminPage(1); setSuperAdminSearch(event.currentTarget.value); }} placeholder="Search Super Admins" /></label><select aria-label="Filter Super Admin accounts by status" value={superAdminStatus} onChange={(event) => { setSuperAdminPage(1); setSuperAdminStatus(event.currentTarget.value); }}><option value="">All statuses</option>{USER_STATUSES.map((status) => <option key={status} value={status}>{enumLabel(status)}</option>)}</select></div><div className="platform-admin-list">{(superAdmins?.items ?? []).map((admin) => <article className="platform-admin-card" key={admin.id}><div className="platform-user-heading"><div><strong>{admin.firstName} {admin.lastName ?? ''}</strong><small>{admin.email}</small></div><span className={'status-pill ' + (admin.status === 'ACTIVE' ? 'status-green' : admin.status === 'INVITED' ? 'status-amber' : 'status-red')}>{enumLabel(admin.status)}</span></div><p className="platform-user-roles">Last sign-in {admin.lastLoginAt ? formatIndianDateTime(new Date(admin.lastLoginAt)) : 'never'}{admin.status === 'INVITED' ? ` · invitation expires ${admin.invitationExpiresAt ? formatIndianDateTime(new Date(admin.invitationExpiresAt)) : 'unknown'}` : ''}{admin.mustChangePassword && admin.emailVerifiedAt ? ' · password change required' : ''}</p><div className="platform-user-actions">{!admin.emailVerifiedAt ? <><button className="button button-secondary button-small" onClick={() => void resendSuperAdminInvitation(admin)} disabled={busy}>{admin.status === 'INVITED' ? 'Resend invitation' : 'Send invitation'}</button>{admin.status === 'INVITED' && <button className="button button-secondary button-small" onClick={() => void updateSuperAdminStatus(admin)} disabled={busy}>Cancel invitation</button>}</> : <button className="button button-secondary button-small" onClick={() => void updateSuperAdminStatus(admin)} disabled={busy || (admin.id === user.id && admin.status === 'ACTIVE')}>{admin.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}</button>}</div><details className="platform-user-edit"><summary>Edit profile or reset password</summary><div className="platform-edit-grid"><form className="platform-form" onSubmit={(event) => void updateSuperAdminProfile(event, admin.id)}><label>First name<input name="firstName" required defaultValue={admin.firstName} /></label><label>Last name<input name="lastName" defaultValue={admin.lastName ?? ''} /></label><label>Email<input name="email" type="email" required defaultValue={admin.email} /></label><button className="button button-secondary button-small" disabled={busy}>Save profile</button></form>{admin.emailVerifiedAt && <form className="platform-form" onSubmit={(event) => void resetSuperAdminPassword(event, admin.id)}><label>Temporary password<input name="temporaryPassword" type="password" required minLength={12} autoComplete="new-password" /></label><button className="button button-secondary button-small" disabled={busy}>Reset password</button></form>}</div></details></article>)}</div><div className="table-footer platform-pagination"><span>{formatIndianNumber(superAdmins?.pagination.total) ?? 0} operators · page {superAdmins?.pagination.page ?? 1} of {Math.max(superAdmins?.pagination.totalPages ?? 1, 1)}</span><div><button className="button button-secondary button-small" disabled={superAdminPage <= 1 || busy} onClick={() => setSuperAdminPage((value) => Math.max(1, value - 1))}>Previous</button><button className="button button-secondary button-small" disabled={!superAdmins || superAdminPage >= superAdmins.pagination.totalPages || busy} onClick={() => setSuperAdminPage((value) => value + 1)}>Next</button></div></div></div>
      </div>
    </section>}
  </main>;
}

function platformViewFromPath(pathname: string): PlatformView {
  if (pathname === '/platform/tenants') return 'tenants';
  if (/^\/platform\/tenants\/[^/]+$/.test(pathname)) return 'tenant-details';
  if (pathname === '/platform/provision') return 'provision';
  if (pathname === '/platform/plans') return 'plans';
  if (pathname === '/platform/admins') return 'admins';
  return 'overview';
}

function platformPathForView(view: PlatformView): string {
  if (view === 'tenants') return '/platform/tenants';
  if (view === 'provision') return '/platform/provision';
  if (view === 'plans') return '/platform/plans';
  if (view === 'admins') return '/platform/admins';
  return '/platform';
}

function tenantDetailTabFromHash(hash: string): TenantDetailTab | null {
  const key = hash.replace(/^#/, '');
  return TENANT_DETAIL_TABS.find(([tab]) => tab === key)?.[0] ?? null;
}

function TenantCard({ tenant, selected, onSelect, onStatus }: { tenant: TenantRow; selected: boolean; onSelect: () => void; onStatus: (status: TenantStatus) => void }) {
  const nextStatus: TenantStatus = tenant.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
  return <article className={'platform-tenant-card ' + (selected ? 'selected' : '')}>
    <div className="platform-tenant-heading"><div><strong>{tenant.name}</strong><small><a href={tenantHref(tenant.tenantHost)} target="_blank" rel="noopener noreferrer">{tenant.tenantHost} <ExternalLink size={12} /></a></small></div><span className={'status-pill ' + (tenant.status === 'ACTIVE' ? 'status-green' : tenant.status === 'SUSPENDED' || tenant.status === 'ARCHIVED' ? 'status-red' : 'status-amber')}>{enumLabel(tenant.status)}</span></div>
    <p>{tenant.contactEmail ?? 'No contact email'}{tenant.countryCode ? ' · ' + tenant.countryCode : ''}</p>
    <div className="platform-tenant-metadata"><span>{organizationCategoryDisplayName(tenant.organizationType)}</span><span>{enumLabel(tenant.subscriptionStatus)}{tenant.subscriptionPlan ? ' · ' + tenant.subscriptionPlan : ''}</span><span>{tenant.usage.activeTenantAdmins} active admins</span><span>{tenant.usage.activeUsers} active users</span></div>
    <small>Trial {tenant.trialEndsAt ? 'ends ' + formatIndianDate(new Date(tenant.trialEndsAt)) : 'date not set'} · Latest sign-in {tenant.usage.latestSignInAt ? formatIndianDate(new Date(tenant.usage.latestSignInAt)) : 'none'}</small>
    <div className="platform-tenant-actions"><button className="button button-secondary button-small" onClick={onSelect}>Manage tenant</button><button className="button button-secondary button-small" disabled={busyFromDisabled(tenant.status)} onClick={() => onStatus(nextStatus)}>{tenant.status === 'ACTIVE' ? 'Suspend' : 'Activate'}</button>{tenant.status !== 'ARCHIVED' && <button className="text-button platform-archive-action" onClick={() => onStatus('ARCHIVED')}>Archive</button>}</div>
  </article>;
}

function PlanEditor({ plan, busy, onSave }: { plan?: PlanRow; busy?: boolean; onSave: (payload: PlanPayload, id?: string) => void }) {
  const [modules, setModules] = useState<string[]>(plan?.modules.filter(({ enabled }) => enabled).map(({ moduleKey }) => moduleKey) ?? [...PLATFORM_MODULES]);
  const [moduleKeyDraft, setModuleKeyDraft] = useState('');
  const [entitlements, setEntitlements] = useState<Array<{ entitlementKey: string; limitValue: string }>>(plan?.entitlements.map(({ entitlementKey, limitValue }) => ({ entitlementKey, limitValue: limitValue === null ? '' : String(limitValue) })) ?? []);
  const currencyNeedsReview = Boolean(plan && plan.currency !== 'INR');
  const locked = Boolean(plan && (plan._count.subscriptions > 0 || currencyNeedsReview));
  const customModules = modules.filter((moduleKey) => !PLATFORM_MODULES.includes(moduleKey as (typeof PLATFORM_MODULES)[number]));

  function addCustomModule() {
    const moduleKey = moduleKeyDraft.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_.-]{0,79}$/.test(moduleKey) || modules.includes(moduleKey)) return;
    setModules((current) => [...current, moduleKey]);
    setModuleKeyDraft('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload: PlanPayload = { name: field(form, 'name'), description: nullableField(form, 'description'), active: form.get('active') === 'on' };
    if (!plan) payload.key = field(form, 'key').toLowerCase();
    if (!locked) Object.assign(payload, {
      monthlyPrice: Number(field(form, 'monthlyPrice')),
      yearlyPrice: Number(field(form, 'yearlyPrice')),
      currency: field(form, 'currency').toUpperCase(),
      trialDays: Number(field(form, 'trialDays')),
      modules: [...new Set([...CORE_TENANT_MODULES, ...modules])],
      entitlements: entitlements.filter(({ entitlementKey }) => entitlementKey.trim()).map(({ entitlementKey, limitValue }) => ({ entitlementKey: entitlementKey.trim().toUpperCase(), limitValue: limitValue.trim() ? Number(limitValue) : null })),
    });
    onSave(payload, plan?.id);
  }

  return <form className="platform-form platform-plan-editor" onSubmit={submit}>
    <div className="platform-form-grid">
      {!plan && <label>Plan key<input name="key" required minLength={2} maxLength={80} pattern="[a-z0-9][a-z0-9-]*[a-z0-9]" placeholder="team-annual" /></label>}
      <label>Plan name<input name="name" required minLength={2} maxLength={160} defaultValue={plan?.name ?? ''} /></label>
      <label>Description<input name="description" maxLength={2000} defaultValue={plan?.description ?? ''} /></label>
      <label>Monthly price<input name="monthlyPrice" type="number" min={0} step="0.0001" required={!locked} disabled={locked} defaultValue={plan?.monthlyPrice ?? '0'} /></label>
      <label>Yearly price<input name="yearlyPrice" type="number" min={0} step="0.0001" required={!locked} disabled={locked} defaultValue={plan?.yearlyPrice ?? '0'} /></label>
      <label>Currency<input name="currency" value="INR" readOnly aria-label="Billing currency, Indian rupees" /></label>
      <label>Trial days<input name="trialDays" type="number" min={0} max={365} step={1} required={!locked} disabled={locked} defaultValue={plan?.trialDays ?? 14} /></label>
      <label className="platform-checkbox-label"><input name="active" type="checkbox" defaultChecked={plan?.active ?? true} /> Available for new tenants</label>
    </div>
    {!locked && <>
      <fieldset className="platform-plan-options"><legend>Included modules</legend><p className="muted">Every plan includes the generic tenant workspace. Add optional modules to the plan as needed.</p><div className="platform-module-options">{[...PLATFORM_MODULES, ...customModules].map((moduleKey) => { const isCore = CORE_TENANT_MODULES.includes(moduleKey as (typeof CORE_TENANT_MODULES)[number]); return <label key={moduleKey}><input type="checkbox" checked={isCore || modules.includes(moduleKey)} disabled={isCore} onChange={(event) => setModules((current) => event.target.checked ? [...current, moduleKey] : current.filter((key) => key !== moduleKey))} />{PLATFORM_MODULE_LABELS[moduleKey as keyof typeof PLATFORM_MODULE_LABELS] ?? enumLabel(moduleKey)}</label>; })}</div><div className="platform-custom-module-add"><label>Custom module key<input value={moduleKeyDraft} onChange={(event) => setModuleKeyDraft(event.target.value)} maxLength={80} pattern="[A-Za-z][A-Za-z0-9_.-]{0,79}" placeholder="MEMBERSHIPS" /></label><button type="button" className="button button-secondary button-small" disabled={!/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(moduleKeyDraft.trim()) || modules.includes(moduleKeyDraft.trim().toUpperCase())} onClick={addCustomModule}>Add module</button></div></fieldset>
      <fieldset className="platform-plan-options"><legend>Usage limits and features</legend>{entitlements.map((item, index) => <div className="platform-plan-entitlement" key={index}><label>Entitlement key<input aria-label={`Entitlement key ${index + 1}`} value={item.entitlementKey} onChange={(event) => setEntitlements((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, entitlementKey: event.target.value } : row))} placeholder="MAX_BRANCHES" /></label><label>Limit<input aria-label={`Entitlement limit ${index + 1}`} type="number" min={0} step={1} value={item.limitValue} onChange={(event) => setEntitlements((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, limitValue: event.target.value } : row))} placeholder="Unlimited" /></label><button type="button" className="text-button" onClick={() => setEntitlements((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remove</button></div>)}<button type="button" className="button button-secondary button-small" onClick={() => setEntitlements((current) => [...current, { entitlementKey: '', limitValue: '' }])}>Add entitlement</button></fieldset>
    </>}
    {locked && <small>{plan?.currency !== 'INR' ? 'This plan uses a legacy currency. Create a new INR plan key; amounts are not automatically converted.' : 'Commercial terms are locked by subscription history. Create a new plan key to change prices, modules, trial length, or limits.'}</small>}
    <button className="button button-primary button-small" disabled={busy || currencyNeedsReview}>{plan ? 'Save plan' : 'Create plan'}</button>
  </form>;
}

function Kpi({ label, value, detail, icon }: { label: string; value: number | string | undefined; detail: string; icon: React.ReactNode }) {
  return <article className="platform-kpi"><span className="platform-kpi-icon">{icon}</span><strong>{formatIndianNumber(value) ?? '—'}</strong><span>{label}</span><small>{detail}</small></article>;
}

function mrrHeadline(rows: Overview['subscriptionsByCurrency'] | undefined): string {
  if (!rows?.length) return formatIndianCurrency('0', 'INR');
  if (rows.some((row) => row.currency !== 'INR')) return rows.every((row) => Number(row.monthlyRecurringRevenue) === 0) ? formatIndianCurrency('0', 'INR') : 'Review currency';
  return rows.length === 1 ? formatIndianCurrency(rows[0]!.monthlyRecurringRevenue, 'INR') : `${rows.length} billing totals`;
}

function amountsByCurrency<T extends { currency: string }>(rows: T[], field: keyof T): string {
  if (rows.some((row) => row.currency !== 'INR')) return rows.every((row) => Number(row[field]) === 0) ? formatIndianCurrency('0', 'INR') : 'Review currency';
  return rows.map((row) => formatIndianCurrency(String(row[field]), 'INR')).join(' · ');
}

function formatPlatformCurrency(value: string | number, currency: string): string {
  if (currency === 'INR') return formatIndianCurrency(value, 'INR');
  return Number(value) === 0 ? formatIndianCurrency('0', 'INR') : 'Review currency';
}

function Usage({ label, value }: { label: string; value: number | string }) {
  return <article className="platform-usage-item"><small>{label}</small><strong>{typeof value === 'number' ? formatIndianNumber(value) : value}</strong></article>;
}

function allowedSubscriptionTransitions(status: SubscriptionStatus): SubscriptionStatus[] {
  const transitions: Record<SubscriptionStatus, SubscriptionStatus[]> = {
    TRIAL: ['ACTIVE', 'PAST_DUE', 'PAUSED', 'CANCELLED', 'EXPIRED'],
    ACTIVE: ['PAST_DUE', 'PAUSED', 'CANCELLED', 'EXPIRED'],
    PAST_DUE: ['ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED'],
    PAUSED: ['ACTIVE', 'CANCELLED', 'EXPIRED'],
    CANCELLED: [],
    EXPIRED: [],
  };
  return transitions[status];
}

function isTenantAdmin(row: UserRow) { return row.userRoles.some(({ role }) => role.key === 'TENANT_ADMIN' || role.key === 'TENANT_OWNER'); }
function field(values: FormData, key: string) { return String(values.get(key) ?? '').trim(); }
function nullableField(values: FormData, key: string) { return field(values, key) || null; }
function tenantHref(host: string) { const url = new URL(window.location.origin); url.hostname = host; url.pathname = '/'; url.search = ''; url.hash = ''; return url.toString(); }
function messageFor(cause: unknown, fallback: string) { return cause instanceof ApiError ? cause.message : fallback; }
function busyFromDisabled(status: TenantStatus) { return status === 'ARCHIVED'; }
