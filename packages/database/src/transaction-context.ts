import { AsyncLocalStorage } from 'node:async_hooks';
import type { DatabaseExecutor } from './client';

/**
 * Makes the active Prisma transaction available to infrastructure checks that
 * run from a query extension. Separate AsyncLocalStorage keeps parallel
 * transactions in one request from borrowing each other's connection.
 */
export class TransactionExecutorContext {
  private readonly storage = new AsyncLocalStorage<DatabaseExecutor>();

  run<T>(executor: DatabaseExecutor, work: () => T): T {
    return this.storage.run(executor, work);
  }

  current(): DatabaseExecutor | undefined {
    return this.storage.getStore();
  }
}
