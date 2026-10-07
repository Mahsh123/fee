import type { EventEmitter } from 'node:events';

export type ShutdownSignal = 'SIGINT' | 'SIGTERM';
type SignalSource = Pick<EventEmitter, 'once' | 'removeListener'>;

/** Waits for an operating-system shutdown signal and removes the unused listener. */
export function waitForShutdown(source: SignalSource = process): Promise<ShutdownSignal> {
  return new Promise((resolve) => {
    const cleanup = () => {
      source.removeListener('SIGINT', onInterrupt);
      source.removeListener('SIGTERM', onTerminate);
    };
    const onInterrupt = () => { cleanup(); resolve('SIGINT'); };
    const onTerminate = () => { cleanup(); resolve('SIGTERM'); };
    source.once('SIGINT', onInterrupt);
    source.once('SIGTERM', onTerminate);
  });
}
