import { describe, expect, it } from 'vitest';
import { createPrismaClient, resolveDatabaseSchema } from './client';

describe('PostgreSQL connection target parsing', () => {
  it('uses the configured query schema and defaults to public when omitted', () => {
    expect(resolveDatabaseSchema('postgresql://fee_runtime:secret@db.internal:5432/fees?schema=public')).toBe('public');
    expect(resolveDatabaseSchema('postgresql://fee_runtime:secret@db.internal:5432/fees')).toBe('public');
  });

  it('rejects driver query parameters that can override connection target or credentials', () => {
    for (const query of ['host=other-db', 'port=6543', 'user=fee_migrator', 'password=secret', 'schema=public&schema=private']) {
      expect(() => resolveDatabaseSchema(`postgresql://fee_runtime:secret@db.internal:5432/fees?${query}`)).toThrow(
        'DATABASE_URL contains unsupported or duplicate query parameters',
      );
    }
    expect(() => resolveDatabaseSchema('postgresql://fee_runtime:secret@db.internal:5432/fees?schema=tenant_data')).toThrow(
      'DATABASE_URL must target the public schema until staged migrations support other schemas',
    );
  });

  it('rejects connection URLs using a non-PostgreSQL protocol', () => {
    expect(() => createPrismaClient({ databaseUrl: 'mysql://user:secret@db.internal/fees' })).toThrow('DATABASE_URL must use PostgreSQL');
  });

  it('accepts Neon TLS and SCRAM channel binding parameters without allowing target overrides', () => {
    const neon = 'postgresql://fee_runtime:secret@ep-example-pooler.region.aws.neon.tech/neondb?sslmode=verify-full&channel_binding=require&schema=public';
    expect(resolveDatabaseSchema(neon)).toBe('public');
    expect(() => resolveDatabaseSchema(neon.replace('sslmode=verify-full', 'sslmode=require'))).toThrow(
      'DATABASE_URL must use sslmode=verify-full and channel_binding=require when these options are present',
    );
    expect(() => resolveDatabaseSchema(neon.replace('channel_binding=require', 'channel_binding=prefer'))).toThrow(
      'DATABASE_URL must use sslmode=verify-full and channel_binding=require when these options are present',
    );
    expect(() => resolveDatabaseSchema('postgresql://fee_runtime:secret@ep-example-pooler.region.aws.neon.tech/neondb')).toThrow(
      'Neon DATABASE_URL must require verified TLS and SCRAM channel binding',
    );
  });
});
