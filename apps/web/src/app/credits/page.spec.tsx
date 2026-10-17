import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import CreditsPage from './page';
import { useSession } from '../../components/session-provider';

vi.mock('../../components/session-provider', () => ({ useSession: vi.fn() }));
vi.mock('../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  apiRequest: vi.fn(),
}));

const mockUseSession = vi.mocked(useSession);

describe('CreditsPage regression tests', () => {
  beforeEach(() => {
    mockUseSession.mockReturnValue({
      user: {
        id: 'admin',
        isPlatformAdmin: true,
        permissions: ['credit.read', 'credit.apply'],
      } as ReturnType<typeof useSession>['user'],
      loading: false,
      update: () => undefined,
    });
  });

  it('renders credit workspace, student picker, summary, and credit history panel', () => {
    const markup = renderToStaticMarkup(createElement(CreditsPage));

    expect(markup).toContain('Credit balances');
    expect(markup).toContain('Apply student credit');
    expect(markup).toContain('Choose a student</option>');
    expect(markup).toContain('Credit history</h2><p>Balances include available, applied, and refunded totals.');
    expect(markup).toContain('No credit history');
  });
});
