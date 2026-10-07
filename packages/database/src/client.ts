import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/client';
import { Prisma } from './generated/client';

/**
 * Prisma 7 connects through a driver adapter rather than a generated query
 * engine, so the connection pool is `pg`'s and the connection string is passed
 * at construction time instead of living in the schema.
 *
 * One client per process. The API builds it once in a Nest provider; the worker
 * builds its own, because a worker must not share a request-scoped pool with
 * the API.
 */

export type DatabaseClient = PrismaClient;
export { Prisma };

export interface CreatePrismaClientOptions {
  databaseUrl: string;
  /** Log slow queries and errors; query text stays off in production. */
  logLevel?: 'error' | 'warn' | 'info' | 'debug';
  /** Pool size. Kept modest because each instance holds its own pool. */
  poolSize?: number;
}

/**
 * Resolve the query schema explicitly for PrismaPg and reject URL query options
 * that pg-connection-string could use to override the URL authority or role.
 * The application connection URL currently supports only `schema`; transport
 * options should be added here deliberately with matching target checks.
 */
export function resolveDatabaseSchema(databaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must use PostgreSQL');
  }
  const entries = [...url.searchParams.entries()];
  const allowedQueryKeys = new Set(['schema', 'sslmode', 'channel_binding']);
  const queryKeys = entries.map(([key]) => key);
  const duplicate = [...new Set(queryKeys)].some((key) => queryKeys.filter((candidate) => candidate === key).length > 1);
  const schemas = url.searchParams.getAll('schema');
  if (queryKeys.some((key) => !allowedQueryKeys.has(key)) || duplicate || schemas.length > 1) {
    throw new Error('DATABASE_URL contains unsupported or duplicate query parameters');
  }
  const sslModes = url.searchParams.getAll('sslmode');
  const channelBindings = url.searchParams.getAll('channel_binding');
  if ((sslModes.length > 0 && sslModes[0] !== 'verify-full')
    || (channelBindings.length > 0 && channelBindings[0] !== 'require')) {
    throw new Error('DATABASE_URL must use sslmode=verify-full and channel_binding=require when these options are present');
  }
  if (url.hostname.toLowerCase().endsWith('.neon.tech')
    && (sslModes[0] !== 'verify-full' || channelBindings[0] !== 'require')) {
    throw new Error('Neon DATABASE_URL must require verified TLS and SCRAM channel binding');
  }
  const schema = schemas.length === 0 ? 'public' : schemas[0];
  if (!schema) throw new Error('DATABASE_URL schema must not be empty');
  if (schema !== 'public') throw new Error('DATABASE_URL must target the public schema until staged migrations support other schemas');
  return schema;
}

export function createPrismaClient(options: CreatePrismaClientOptions): PrismaClient {
  if (!options.databaseUrl) {
    throw new Error('createPrismaClient requires a databaseUrl');
  }

  const schema = resolveDatabaseSchema(options.databaseUrl);
  const adapter = new PrismaPg({
    connectionString: options.databaseUrl,
    max: options.poolSize ?? 10,
  }, { schema });

  return new PrismaClient({
    adapter,
    log:
      options.logLevel === 'debug'
        ? [{ emit: 'event', level: 'query' }, { emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }]
        : options.logLevel === 'info'
          ? [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }]
          : [{ emit: 'stdout', level: 'error' }],
  });
}

/**
 * The transaction client type. Services accept this rather than the full client
 * wherever they may be called inside a transaction, which is how the atomicity
 * of money-moving operations is enforced by the type system rather than by
 * convention.
 */
export type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends' |
    '$queryRaw' | '$queryRawUnsafe' | '$executeRaw' | '$executeRawUnsafe'
>;

/** Narrow transaction-bound RPCs for database-owned document numbering. */
export interface NumberingTransactionOperations {
  reserveDocumentNumber(input: {
    tenantId: string;
    kind: string;
    scope: string | null;
    asOfDate: string;
    consume: boolean;
  }): Promise<string>;
  lockNumberingConfiguration(tenantId: string): Promise<void>;
}

export type NumberingTransactionClient = TransactionClient & NumberingTransactionOperations;

/** Narrow transaction-bound audit serialization used by the bridge writer. */
export interface AuditTransactionOperations {
  prepareAuditAppend(tenantId: string): Promise<{ mode: 'legacy'; recordedAt: Date } | { mode: 'v2' }>;
  verifyAuditChain(tenantId: string, limit: number): Promise<
    { mode: 'legacy' } |
    { mode: 'v2'; result: { intact: boolean; checked: number; brokenAt?: string } }
  >;
  readAuditLogs(input: {
    tenantId: string;
    id?: string;
    filters: { entityType: string | null; action: string | null; from: string | null; to: string | null; search: string | null };
    offset: number;
    limit: number;
    sort: Array<{ field: 'createdAt' | 'action' | 'entityType' | 'severity'; direction: 'asc' | 'desc' }>;
  }): Promise<
    { mode: 'legacy' } |
    { mode: 'v2'; result: { item: Record<string, unknown> | null } | { items: Record<string, unknown>[]; total: number } }
  >;
  appendSignedAudit(input: {
    tenantId: string;
    actorId: string | null;
    requestId: string | null;
    envelopeJson: string;
    signature: Uint8Array;
  }): Promise<string>;
}

export type AuditTransactionClient = TransactionClient & AuditTransactionOperations;

/** Full transaction handle kept inside the database package for fixed SQL helpers. */
export type InternalTransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export type DatabaseExecutor = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends' |
    '$queryRaw' | '$queryRawUnsafe' | '$executeRaw' | '$executeRawUnsafe'
> | TransactionClient;

/** Public API view of the tenant-extended client; arbitrary SQL and lifecycle bypasses stay private. */
export type TenantScopedDatabaseClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends' |
    '$queryRaw' | '$queryRawUnsafe' | '$executeRaw' | '$executeRawUnsafe'
>;

/**
 * PostgreSQL error codes worth branching on. Mapping them here keeps raw driver
 * errors out of service code and out of API responses.
 */
export const PG_ERROR_CODES = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  NOT_NULL_VIOLATION: '23502',
  CHECK_VIOLATION: '23514',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
} as const;

export function pgErrorCode(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

export function isUniqueViolation(error: unknown): boolean {
  return pgErrorCode(error) === 'P2002' || pgErrorCode(error) === PG_ERROR_CODES.UNIQUE_VIOLATION;
}

export function isForeignKeyViolation(error: unknown): boolean {
  return pgErrorCode(error) === 'P2003' || pgErrorCode(error) === PG_ERROR_CODES.FOREIGN_KEY_VIOLATION;
}

/**
 * True when the failure was a transient concurrency conflict and the whole
 * transaction may safely be retried. Financial work is retried only as a whole
 * transaction, never at the statement level.
 */
export function isRetryableConflict(error: unknown): boolean {
  const code = pgErrorCode(error);
  return code === PG_ERROR_CODES.SERIALIZATION_FAILURE || code === PG_ERROR_CODES.DEADLOCK_DETECTED || code === 'P2034';
}
