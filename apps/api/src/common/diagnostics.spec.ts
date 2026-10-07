import { describe, expect, it } from 'vitest';
import { safeOperationalErrorCode } from './diagnostics';

describe('safe operational error codes', () => {
  it('reports known application codes without exposing the message', () => {
    expect(safeOperationalErrorCode(Object.assign(new Error('Sensitive detail'), { code: 'PERMISSION_DENIED' })))
      .toBe('PERMISSION_DENIED');
  });

  it('labels Prisma and PostgreSQL error codes without logging SQL details', () => {
    expect(safeOperationalErrorCode(Object.assign(new Error('query and parameters'), { code: 'P2021' })))
      .toBe('DATABASE_P2021');
    expect(safeOperationalErrorCode(Object.assign(new Error('query and parameters'), { code: '42501' })))
      .toBe('DATABASE_42501');
  });

  it('uses the caller fallback for errors without a safe code', () => {
    expect(safeOperationalErrorCode(new Error('connection string contains secret'))).toBe('INTERNAL_ERROR');
    expect(safeOperationalErrorCode(new Error('details omitted'), 'WORKER_OPERATION_FAILED')).toBe('WORKER_OPERATION_FAILED');
  });
});
