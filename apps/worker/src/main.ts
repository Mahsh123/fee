import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadWorkerEnv } from '@fee/config';
import { createLogger } from '@fee/logger';
import { waitForShutdown } from './shutdown';
import { WorkerModule } from './worker.module';

/** Boots the worker process without consuming jobs until tenant context is available. */
export async function runWorker(): Promise<void> {
  const config = loadWorkerEnv();
  const logger = createLogger({ service: 'fee-platform-worker', level: config.LOG_LEVEL, environment: config.NODE_ENV });
  const app = await NestFactory.createApplicationContext(WorkerModule.register(config), { logger: false, abortOnError: false });
  logger.info('Worker application context started');
  try {
    const signal = await waitForShutdown();
    logger.info({ signal }, 'Worker shutdown requested');
  } finally {
    await app.close();
    logger.info('Worker application context stopped');
    logger.flush();
  }
}

if (require.main === module) {
  void runWorker().catch((error: unknown) => {
    const logger = createLogger({ service: 'fee-platform-worker', level: 'info' });
    logger.fatal({ err: error }, 'Worker failed to start or stop cleanly');
    logger.flush();
    process.exitCode = 1;
  });
}
