import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import FeeDemandsPage from './page';
import { parseDecimalToUnits, unitsToDecimalString } from '@fee/money';

vi.mock('../../lib/api', () => ({
  ApiError: class ApiError extends Error {},
  apiRequest: vi.fn(),
}));

describe('FeeDemandsPage regression tests', () => {
  it('renders search input, status filter, and empty/loading states correctly', () => {
    const markup = renderToStaticMarkup(createElement(FeeDemandsPage));

    expect(markup).toContain('aria-label="Search fee demands"');
    expect(markup).toContain('placeholder="Search demand #, student, person"');
    expect(markup).toContain('Search</button>');
    expect(markup).toContain('All statuses</option>');
    expect(markup).toContain('No demands found');
    expect(markup).toContain('Choose a demand');
  });

  it('performs exact monetary arithmetic without silent truncation or float inaccuracy', () => {
    // Normal addition
    const unitsA = parseDecimalToUnits('15000.5000');
    const unitsB = parseDecimalToUnits('-2500.2500');
    expect(unitsToDecimalString(unitsA + unitsB, 4, 4)).toBe('12500.2500');

    // Negative results
    const unitsC = parseDecimalToUnits('500.0000');
    const unitsD = parseDecimalToUnits('-750.5000');
    expect(unitsToDecimalString(unitsC + unitsD, 4, 4)).toBe('-250.5000');

    // Decimal rounding HALF_UP on over-precision values, never silent truncation
    const unitsOver = parseDecimalToUnits('100.12346');
    expect(unitsToDecimalString(unitsOver, 4, 4)).toBe('100.1235');
  });
});
