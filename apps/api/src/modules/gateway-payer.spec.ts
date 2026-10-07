import { describe, expect, it } from 'vitest';
import { resolveOrderPayerType } from './gateway-payer';

describe('resolveOrderPayerType', () => {
  it('defaults a parent portal checkout to the authenticated guardian responsibility', () => {
    expect(resolveOrderPayerType(undefined, { portalOnly: true, isParentPortal: true })).toBe('PARENT');
    expect(resolveOrderPayerType('GUARDIAN', { portalOnly: true, isParentPortal: true })).toBe('GUARDIAN');
  });

  it('defaults a student portal checkout to the student responsibility', () => {
    expect(resolveOrderPayerType(undefined, { portalOnly: true, isParentPortal: false })).toBe('STUDENT');
  });

  it('prevents portal users from initiating orders for another payer identity', () => {
    expect(() => resolveOrderPayerType('STUDENT', { portalOnly: true, isParentPortal: true })).toThrow();
    expect(() => resolveOrderPayerType('PARENT', { portalOnly: true, isParentPortal: false })).toThrow();
  });

  it('preserves configurable payer types for authorized staff', () => {
    expect(resolveOrderPayerType('SPONSOR', { portalOnly: false, isParentPortal: false })).toBe('SPONSOR');
  });
});
