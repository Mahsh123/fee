import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StudentsPage from './page';

vi.mock('../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  apiRequest: vi.fn(),
}));

describe('StudentsPage regression tests', () => {
  it('renders search input, search button, add student popover, and loading state', () => {
    const markup = renderToStaticMarkup(createElement(StudentsPage));

    expect(markup).toContain('placeholder="Search name, admission number, email"');
    expect(markup).toContain('aria-label="Search students"');
    expect(markup).toContain('<button class="button button-secondary">Search</button>');
    expect(markup).toContain('Add student');
    expect(markup).toContain('First name');
    expect(markup).toContain('Last name');
    expect(markup).toContain('Branch');
    expect(markup).toContain('Loading students…');
  });
});
