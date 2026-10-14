import { describe, expect, it } from 'vitest';
import { calculateBaseAmount } from './base-amount';

const context = {
  evaluationDate: '2026-10-13',
  student: { id: 'person-a' },
  fee: { amount: '25', quantity: '4', percentBase: '100' },
};

describe('generic usage and formula fee amounts', () => {
  it('calculates cycle usage from the captured fee quantity', () => {
    const result = calculateBaseAmount({
      method: 'USAGE', amount: '25', config: { schemaVersion: 1, kind: 'USAGE', quantityPath: 'fee.quantity' },
      context, currency: 'INR',
    });
    expect(result.amount).toBe('100.0000');
    expect(result.resolvedInputs).toMatchObject({ 'fee.quantity': '4.0000', 'fee.amount': '25' });
  });

  it('evaluates a bounded formula against the cycle quantity and fee facts', () => {
    const result = calculateBaseAmount({
      method: 'FORMULA', amount: '25', quantity: '4', percentBase: '100',
      config: { schemaVersion: 1, kind: 'FORMULA', expression: 'fee.amount * fee.quantity + fee.percentBase' },
      context, currency: 'INR',
    });
    expect(result.amount).toBe('200.0000');
  });

  it('rejects a usage fee when a cycle quantity is missing', () => {
    expect(() => calculateBaseAmount({
      method: 'USAGE', amount: '25', config: { schemaVersion: 1, kind: 'USAGE', quantityPath: 'fee.quantity' },
      context: { evaluationDate: '2026-10-13', student: { id: 'person-a' }, fee: { amount: '25' } }, currency: 'INR',
    })).toThrow(/is not available for this person/);
  });
});
