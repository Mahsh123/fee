import { describe, expect, it } from 'vitest';
import { TransactionExecutorContext } from './transaction-context';

describe('transaction executor context', () => {
  it('isolates parallel transactions and restores the outer context after completion', async () => {
    const context = new TransactionExecutorContext();
    const seen: string[] = [];

    await Promise.all(
      ['transaction-a', 'transaction-b'].map((id) =>
        context.run(id as never, async () => {
          await new Promise((resolve) => setTimeout(resolve, id.endsWith('a') ? 4 : 1));
          seen.push((context.current() as unknown as string) ?? 'missing');
        }),
      ),
    );

    expect(seen).toEqual(['transaction-b', 'transaction-a']);
    expect(context.current()).toBeUndefined();
  });
});
