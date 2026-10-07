/**
 * @fee/database
 *
 * A thin boundary around the generated Prisma client:
 *   - the driver-adapter construction (`createPrismaClient`)
 *   - the executor types that make transactional call sites explicit
 *   - money conversion at the database edge
 *   - retryable-conflict detection for concurrent write attempts
 *
 * Nothing here contains business rules. It exists so that the rest of the
 * codebase has exactly one place that knows how to talk to PostgreSQL.
 */

export {
  createPrismaClient,
  isForeignKeyViolation,
  isRetryableConflict,
  isUniqueViolation,
  pgErrorCode,
  PG_ERROR_CODES,
  Prisma,
  type CreatePrismaClientOptions,
  type DatabaseClient,
  type DatabaseExecutor,
  type TenantScopedDatabaseClient,
  type TransactionClient,
  type NumberingTransactionOperations,
  type NumberingTransactionClient,
  type AuditTransactionOperations,
  type AuditTransactionClient,
} from './client';

export {
  asDecimal,
  decimalToMoneyString,
  MONEY_DECIMAL_PRECISION,
  MONEY_DECIMAL_SCALE,
  moneyToDecimal,
  normaliseMoneyString,
  sumDecimalStrings,
} from './money';

export { runInTransaction, withRetryOnConflict } from './transaction';
export { TransactionExecutorContext } from './transaction-context';

export {
  TENANT_FOREIGN_KEY_TARGETS,
  TENANT_OPAQUE_NON_UUID_FIELDS,
  TENANT_OPAQUE_UUID_FIELDS,
  type TenantReferenceRule,
  type TenantReferenceTarget,
} from './tenant-relations.generated';

/** Every generated model, enum and input type, re-exported. */
export * from './generated/client';
