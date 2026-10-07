import type { Metadata } from 'next';
import './globals.css';
import { SessionProvider } from '../components/session-provider';
import { ApplicationShell } from '../components/application-shell';
import { TenantProvider } from '../components/tenant-provider';

export const metadata: Metadata = {
  title: { default: 'Fee Platform', template: '%s | Fee Platform' },
  description: 'A secure workspace for institution fee collection and finance operations.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
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
