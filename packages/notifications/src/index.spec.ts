import { describe, expect, it } from 'vitest';
import { renderTemplate } from './index';

describe('configurable notification template renderer', () => {
  it('renders nested caller-provided values as plain text and preserves scalar values', () => {
    expect(renderTemplate('Hello {{payer.name}}: {{amount}}', { payer: { name: '<Sam>' }, amount: 0 }))
      .toBe('Hello <Sam>: 0');
  });

  it('fails clearly on missing values and non-scalar substitutions', () => {
    expect(() => renderTemplate('Hello {{payer.name}}', {})).toThrow(/payer.name/);
    expect(() => renderTemplate('{{payer}}', { payer: { name: 'Sam' } })).toThrow(/must be a string/);
  });

  it('does not resolve inherited or prototype-sensitive properties', () => {
    const values = Object.create({ inherited: 'unsafe' }) as Record<string, unknown>;
    expect(() => renderTemplate('{{inherited}}', values)).toThrow(/not supplied/);
    expect(() => renderTemplate('{{constructor.name}}', {})).toThrow(/not supplied/);
  });
});
