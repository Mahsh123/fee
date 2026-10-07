'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { refreshSession, readSession, type BrowserSession, type SessionUser } from '../lib/api';
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
    if (tenant.kind === 'loading') return;
    const matchesHost = (candidate: BrowserSession | null) => {
      if (!candidate) return false;
      if (tenant.kind === 'platform') return candidate.user.isPlatformAdmin && candidate.user.tenantSlug === PLATFORM_SYSTEM_TENANT_SLUG;
      if (tenant.kind === 'tenant') return candidate.user.tenantSlug === tenant.slug && !candidate.user.isPlatformAdmin;
      return false;
    };
    const existing = readSession();
    if (matchesHost(existing)) setSession(existing);
    else { setSession(null); }
    void refreshSession()
      .then((fresh) => {
        if (matchesHost(fresh)) setSession(fresh);
        else setSession(null);
      })
      .finally(() => setLoading(false));
  }, [tenant]);
  const value = useMemo(() => ({ user: session?.user ?? null, loading, update: setSession }), [session, loading]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
