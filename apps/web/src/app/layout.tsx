import type { Metadata } from 'next';
import './globals.css';
import { SessionProvider } from '../components/session-provider';
import { ApplicationShell } from '../components/application-shell';
import { TenantProvider } from '../components/tenant-provider';

export const metadata: Metadata = {
  title: { default: 'Wasl', template: '%s | Wasl' },
  description: 'Connect. Track. Report. Wasl brings independent organization workspaces and configurable workflows together securely.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN">
      <body>
        <TenantProvider>
          <SessionProvider>
            <a className="skip-link" href="#main-content">Skip to content</a>
            <ApplicationShell>{children}</ApplicationShell>
          </SessionProvider>
        </TenantProvider>
      </body>
    </html>
  );
}
