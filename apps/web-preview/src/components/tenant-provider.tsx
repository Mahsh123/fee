'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { getPublicTenantContext, type PublicTenantContext } from '../lib/api';

type TenantState = { kind: 'loading' } | { kind: 'error' } | PublicTenantContext;

const TenantContext = createContext<TenantState>({ kind: 'loading' });

export function TenantProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [tenant, setTenant] = useState<TenantState>({ kind: 'loading' });

  useEffect(() => {
    let mounted = true;
    void getPublicTenantContext()
      .then((resolved) => { if (mounted) setTenant(resolved); })
      .catch(() => { if (mounted) setTenant({ kind: 'error' }); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (tenant.kind === 'tenant') {
      if (/^#[0-9a-f]{6}$/i.test(tenant.branding.primaryColor)) root.style.setProperty('--tenant-primary', tenant.branding.primaryColor);
      if (/^#[0-9a-f]{6}$/i.test(tenant.branding.accentColor)) root.style.setProperty('--tenant-accent', tenant.branding.accentColor);
      document.title = tenant.branding.organizationName;
    } else {
      root.style.removeProperty('--tenant-primary');
      root.style.removeProperty('--tenant-accent');
    }
  }, [tenant]);

  const value = useMemo(() => tenant, [tenant]);
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant() {
  return useContext(TenantContext);
}
