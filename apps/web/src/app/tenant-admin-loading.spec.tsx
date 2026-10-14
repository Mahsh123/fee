import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AccessPage from './access/page';
import AttendancePage from './attendance/page';
import OrganizationPage from './organization/page';
import { useSession } from '../components/session-provider';

vi.mock('../components/session-provider', () => ({ useSession: vi.fn() }));
vi.mock('../lib/api', () => ({ ApiError: class ApiError extends Error {}, apiRequest: vi.fn() }));

const mockUseSession = vi.mocked(useSession);

describe('tenant administration initial loading states', () => {
  beforeEach(() => {
    mockUseSession.mockReturnValue({
      user: {
        id: 'tenant-admin', tenantId: 'tenant-a', tenantName: 'Wasl Demo', tenantSlug: 'wasl-demo',
        firstName: 'Tenant', lastName: 'Admin', email: 'admin@example.test', roles: ['TENANT_ADMIN'],
        permissions: [
          'user.read', 'user.create', 'user.disable', 'role.read', 'role.assign', 'permission.read',
          'branch.read', 'branch.manage', 'organization.unit.read', 'organization.unit.manage',
          'assignment.read', 'assignment.manage', 'student.read', 'attendance.read', 'attendance.mark', 'attendance.correct',
        ], isPlatformAdmin: false, mustChangePassword: false,
      } as ReturnType<typeof useSession>['user'],
      loading: false,
      update: () => undefined,
    });
  });

  it('shows a loading state instead of falsely showing an empty user and role directory', () => {
    const markup = renderToStaticMarkup(createElement(AccessPage));

    expect(markup).toContain('Loading users, roles, and access scopes');
    expect(markup).not.toContain('No users found');
    expect(markup).not.toContain('No tenant roles');
  });

  it('shows a loading state instead of falsely showing an empty organization', () => {
    const markup = renderToStaticMarkup(createElement(OrganizationPage));

    expect(markup).toContain('Loading branches, groups, and user assignments');
    expect(markup).not.toContain('No branches are available');
    expect(markup).not.toContain('No assignments are listed');
  });

  it('shows a loading state while attendance setup is loading', () => {
    const markup = renderToStaticMarkup(createElement(AttendancePage));

    expect(markup).toContain('Loading branches and groups');
    expect(markup).not.toContain('Attendance setup is incomplete');
  });
});
