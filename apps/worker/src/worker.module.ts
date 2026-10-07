import { Module, type DynamicModule } from '@nestjs/common';
import type { WorkerEnv } from '@fee/config';
import { NotificationRuntime, WORKER_CONFIG } from './notification-runtime';

@Module({})
export class WorkerModule {
  static register(config: WorkerEnv): DynamicModule {
    return {
      module: WorkerModule,
      providers: [
        { provide: WORKER_CONFIG, useValue: config },
        NotificationRuntime,
      ],
    };
  }
}
