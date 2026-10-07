'use client';

import type { ApiResponse } from '@fee/types';

export interface SessionUser {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  email: string;
  firstName: string;
  lastName: string | null;
  roles: string[];
  permissions: string[];
  isPlatformAdmin: boolean;
  studentId: string | null;
  guardianId: string | null;
  mustChangePassword: boolean;
}

export interface BrowserSession {
  accessToken: string;
  expiresIn: number;
  user: SessionUser;
}

const CONFIGURED_API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;
const SESSION_KEY = 'fee-platform-session';
let currentSession: BrowserSession | null = null;
let refreshInFlight: Promise<BrowserSession | null> | null = null;

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export type PublicTenantContext =
  | { kind: 'platform' }
  | { kind: 'unknown' }
  | { kind: 'inactive'; slug: string; name: string }
  | {
      kind: 'tenant';
      slug: string;
      name: string;
      enabledModules: string[];
      branding: {
    organizationName: string;
    logoUrl: string | null;
    primaryColor: string;
    accentColor: string;
    landingTitle: string | null;
    landingDescription: string | null;
    landingActionLabel: string | null;
      };
    };

function apiBase(): string {
  if (typeof window === 'undefined') return CONFIGURED_API_BASE ?? 'http://localhost:4000/api/v1';
  if (!CONFIGURED_API_BASE) return `${window.location.origin}/api/v1`;
  try {
    const apiUrl = new URL(CONFIGURED_API_BASE);
    const pageHost = window.location.hostname.toLowerCase();
    const apiHost = apiUrl.hostname.toLowerCase();
    const baseDomain = apiHost.startsWith('platform.') ? apiHost.slice('platform.'.length) : apiHost;
    const platformHost = `platform.${baseDomain}`;
    const tenantSuffix = `.${baseDomain}`;
    const tenantPrefix = pageHost.endsWith(tenantSuffix) ? pageHost.slice(0, -tenantSuffix.length) : '';
    const isTenantHost = Boolean(tenantPrefix) && !tenantPrefix.includes('.') && pageHost !== platformHost;
    if (pageHost === platformHost || isTenantHost) apiUrl.hostname = pageHost;
    return apiUrl.toString().replace(/\/$/, '');
  } catch {
    return `${window.location.origin}/api/v1`;
  }
}

export async function getPublicTenantContext(): Promise<PublicTenantContext> {
  const response = await fetch(`${apiBase()}/tenant-context`, { credentials: 'include', cache: 'no-store' });
  const body = (await response.json().catch(() => null)) as ApiResponse<PublicTenantContext> | null;
  if (!response.ok || !body?.success) throw new ApiError('Tenant information could not be loaded.', response.status);
  return body.data;
}

/** Point unknown-host recovery links at the dedicated platform host. */
export function platformHomeHref(): string {
  if (typeof window === 'undefined') return '/';
  const home = new URL(window.location.href);
  try {
    const pageHost = home.hostname.toLowerCase();
    const configuredApiHost = CONFIGURED_API_BASE
      ? new URL(CONFIGURED_API_BASE).hostname.toLowerCase()
      : pageHost === 'localhost' || pageHost.endsWith('.localhost') ? 'localhost' : pageHost;
    const baseDomain = configuredApiHost.startsWith('platform.') ? configuredApiHost.slice('platform.'.length) : configuredApiHost;
    home.hostname = `platform.${baseDomain}`;
  } catch {
    if (home.hostname === 'localhost' || home.hostname.endsWith('.localhost')) home.hostname = 'platform.localhost';
  }
  home.pathname = '/';
  home.search = '';
  home.hash = '';
  return home.toString();
}

export function readSession(): BrowserSession | null {
  if (typeof window === 'undefined') return null;
  if (currentSession) return currentSession;
  try {
    const stored = window.sessionStorage.getItem(SESSION_KEY);
    currentSession = stored ? (JSON.parse(stored) as BrowserSession) : null;
  } catch {
    currentSession = null;
  }
  return currentSession;
}

export function saveSession(session: BrowserSession): void {
  currentSession = session;
  if (typeof window !== 'undefined') window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  currentSession = null;
  if (typeof window !== 'undefined') window.sessionStorage.removeItem(SESSION_KEY);
}

export async function signIn(input: { email: string; password: string }): Promise<BrowserSession> {
  const session = await request<BrowserSession>('/auth/login', { method: 'POST', body: JSON.stringify(input) }, false);
  saveSession(session);
  return session;
}

export async function signOut(): Promise<void> {
  try {
    await fetch(`${apiBase()}/auth/logout`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: '{}' });
  } finally {
    clearSession();
  }
}

export async function refreshSession(): Promise<BrowserSession | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const session = await request<BrowserSession>('/auth/refresh', { method: 'POST', body: '{}' }, false);
      saveSession(session);
      return session;
    } catch {
      clearSession();
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, init, true);
}

async function request<T>(path: string, init: RequestInit, retry401: boolean): Promise<T> {
  const session = readSession();
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
  if (session?.accessToken) headers.set('authorization', `Bearer ${session.accessToken}`);
  let response = await fetch(`${apiBase()}${path}`, { ...init, headers, credentials: 'include', cache: 'no-store' });
  if (response.status === 401 && retry401) {
    const renewed = await refreshSession();
    if (renewed) {
      headers.set('authorization', `Bearer ${renewed.accessToken}`);
      response = await fetch(`${apiBase()}${path}`, { ...init, headers, credentials: 'include', cache: 'no-store' });
    }
  }
  const body = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!response.ok || !body?.success) {
    throw new ApiError(body && !body.success ? body.error.message : 'The server could not complete this request.', response.status, body && !body.success ? body.error.code : undefined);
  }
  return body.data;
}
