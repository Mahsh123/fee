import { isRetryableConflict, type DatabaseClient, type InternalTransactionClient, type TransactionClient } from './client';

/**
 * Transactions for money-moving work.
 *
 * Every operation that writes more than one financial row runs inside
 * `runInTransaction`, and a concurrent-write conflict is retried by re-running
 * the *whole* transaction. Retrying a single statement after a rollback would
 * operate on state that no longer exists.
 */

export interface TransactionOptions {
  /** Transactions that touch money use Serializable. */
  isolationLevel?: 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
  timeoutMs?: number;
  maxWaitMs?: number;
}

const DEFAULT_OPTIONS: Required<Omit<TransactionOptions, 'isolationLevel'>> & { isolationLevel: NonNullable<TransactionOptions['isolationLevel']> } = {
  isolationLevel: 'Serializable',
  timeoutMs: 15_000,
  maxWaitMs: 5_000,
};

export async function runInTransaction<T>(
  client: DatabaseClient,
  work: (tx: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const settings = { ...DEFAULT_OPTIONS, ...options };
  return client.$transaction((tx) => work(tx as unknown as TransactionClient), {
    isolationLevel: settings.isolationLevel,
    timeout: settings.timeoutMs,
    maxWait: settings.maxWaitMs,
  });
}

export interface RetryOptions {
  attempts?: number;
  /** Base delay; doubled each attempt with jitter. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: unknown) => void;
}

/**
 * Retries a transaction only when the failure is a genuine concurrency conflict.
 *
 * A unique-constraint violation is never retried: it means the operation already
 * happened, and retrying would be the double-charge the constraint exists to
 * prevent. That distinction is the whole reason this wrapper exists rather than
 * a blanket retry.
 */
export async function withRetryOnConflict<T>(
  client: DatabaseClient,
  work: (tx: TransactionClient) => Promise<T>,
  transactionOptions: TransactionOptions = {},
  retryOptions: RetryOptions = {},
): Promise<T> {
  const attempts = retryOptions.attempts ?? 3;
  const baseDelay = retryOptions.baseDelayMs ?? 50;
  const maxDelay = retryOptions.maxDelayMs ?? 1_000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runInTransaction(client, work, transactionOptions);
    } catch (error) {
      lastError = error;
      if (!isRetryableConflict(error) || attempt === attempts) throw error;
      retryOptions.onRetry?.(attempt, error);
      const delay = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * delay * 0.25);
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }
  throw lastError;
}

/**
 * Takes a row lock for the duration of the transaction.
 *
 * Used where a read-then-write race would otherwise let two clerks collect
 * against the same outstanding balance. `FOR UPDATE` is explicit rather than
 * implied, because relying on optimistic revalidation alone leaves a retry storm
 * at the collection counter.
 */
export async function lockRowForUpdate(
  tx: InternalTransactionClient,
  table: 'fee_demands' | 'fee_demand_items' | 'payments' | 'credits' | 'payment_orders',
  id: string,
  tenantId: string,
): Promise<void> {
  // Table and column names cannot be parameterised, so the table is chosen from a
  // closed union rather than interpolated from caller input.
  const tableMap: Record<typeof table, string> = {
    fee_demands: 'fee_demands',
    fee_demand_items: 'fee_demand_items',
    payments: 'payments',
    credits: 'credits',
    payment_orders: 'payment_orders',
  };
  const safeTable = tableMap[table];
  await tx.$executeRawUnsafe(
    `SELECT id FROM "${safeTable}" WHERE id = $1::uuid AND "tenantId" = $2::uuid FOR UPDATE`,
    id,
    tenantId,
  );
}
