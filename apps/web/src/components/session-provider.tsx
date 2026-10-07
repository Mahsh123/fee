'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { clearSession, refreshSession, readSession, type BrowserSession, type SessionUser } from '../lib/api';
import { useTenant } from './tenant-provider';
import { PLATFORM_SYSTEM_TENANT_SLUG } from '@fee/types';

interface SessionContextValue {
  user: SessionUser | null;
  loading: boolean;
  update: (session: BrowserSession | null) => void;
}

const SessionContext = createContext<SessionContextValue>({ user: null, loading: true, update: () => undefined });

export function SessionProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const tenant = useTenant();
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    if (tenant.kind === 'loading') { setLoading(true); return () => { active = false; }; }
    const existing = readSession();
    if (tenant.kind !== 'platform' && tenant.kind !== 'tenant') {
      if (tenant.kind === 'unknown' || tenant.kind === 'inactive') clearSession();
      setSession(null);
      setLoading(false);
      return () => { active = false; };
    }

    const matchesHost = (candidate: BrowserSession | null) => sessionMatchesHost(candidate?.user ?? null, tenant);
    setLoading(true);
    if (existing && !matchesHost(existing)) {
      // Keep only the account identity long enough to explain the correct host.
      // Remove its credentials immediately so requests on this host cannot use them.
      clearSession();
      setSession(existing);
      setLoading(false);
      return () => { active = false; };
    }
    setSession(existing);
    void refreshSession()
      .then((fresh) => {
        if (!active) return;
        if (matchesHost(fresh)) setSession(fresh);
        else if (fresh) {
          clearSession();
          setSession(fresh);
        } else setSession(null);
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tenant]);

  function update(next: BrowserSession | null) {
    if (!next) {
      clearSession();
      setSession(null);
      return;
    }
    if ((tenant.kind === 'platform' || tenant.kind === 'tenant') && !sessionMatchesHost(next.user, tenant)) {
      clearSession();
      setSession(next);
      return;
    }
    setSession(next);
  }

  const hostScopedUser = session && sessionMatchesHost(session.user, tenant) ? session.user : null;
  const value = useMemo(() => ({ user: hostScopedUser, loading, update }), [hostScopedUser, loading, tenant]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function sessionMatchesHost(
  user: SessionUser | null,
  tenant: ReturnType<typeof useTenant>,
): boolean {
  if (!user) return false;
  if (tenant.kind === 'platform') return user.isPlatformAdmin && user.tenantSlug === PLATFORM_SYSTEM_TENANT_SLUG;
  if (tenant.kind === 'tenant') return user.tenantSlug === tenant.slug && !user.isPlatformAdmin;
  return false;
}

export function useSession() {
  return useContext(SessionContext);
}
