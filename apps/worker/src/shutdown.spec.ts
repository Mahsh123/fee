import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { waitForShutdown } from './shutdown';

describe('worker shutdown lifecycle', () => {
  it('resolves on SIGTERM and removes both signal listeners', async () => {
    const signals = new EventEmitter();
    const shutdown = waitForShutdown(signals);
    expect(signals.listenerCount('SIGINT')).toBe(1);
    expect(signals.listenerCount('SIGTERM')).toBe(1);
    signals.emit('SIGTERM');
    await expect(shutdown).resolves.toBe('SIGTERM');
    expect(signals.listenerCount('SIGINT')).toBe(0);
    expect(signals.listenerCount('SIGTERM')).toBe(0);
  });
});
