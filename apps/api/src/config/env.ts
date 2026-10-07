import { Global, Module } from '@nestjs/common';
import { RuntimeConfig } from '@fee/config';

export { envSchema, loadEnv } from '@fee/config';
export type { Env } from '@fee/config';

/** Nest adapter for the process-agnostic shared runtime configuration. */
export class AppConfigService extends RuntimeConfig {}

/** Global module so configuration is injectable without per-feature imports. */
@Global()
@Module({
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class AppConfigModule {}
