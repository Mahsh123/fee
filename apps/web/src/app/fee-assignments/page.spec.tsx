import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import FeeAssignmentsPage from './page';
import { useSession } from '../../components/session-provider';

vi.mock('../../components/session-provider', () => ({ useSession: vi.fn() }));
vi.mock('../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  apiRequest: vi.fn(),
}));

const mockUseSession = vi.mocked(useSession);

describe('FeeAssignmentsPage regression tests', () => {
  beforeEach(() => {
    mockUseSession.mockReturnValue({
      user: {
        id: 'admin',
        isPlatformAdmin: true,
        permissions: ['student.read', 'user.read', 'assignment.manage'],
      } as ReturnType<typeof useSession>['user'],
      loading: false,
      update: () => undefined,
    });
  });

  it('renders branch selector, fee structure selector, and assignment target types', () => {
    const markup = renderToStaticMarkup(createElement(FeeAssignmentsPage));

    expect(markup).toContain('New assignment');
    expect(markup).toContain('Choose a branch</option>');
    expect(markup).toContain('Choose a schedule</option>');
    expect(markup).toContain('Education students</option>');
    expect(markup).toContain('Find organisation people');
    expect(markup).toContain('0 assignments');
  });
});
