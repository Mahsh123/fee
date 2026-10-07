import { defineConfig, env } from 'prisma/config';

/**
 * Prisma ORM v7 moved the datasource URL out of `schema.prisma` and into this
 * config file. The runtime client connects through a driver adapter
 * (`@prisma/adapter-pg`) created in `packages/database/src/client.ts`, while the
 * Schema migrations use a dedicated one-shot credential. Runtime DATABASE_URL
 * is intentionally not loaded into the Prisma migration process.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: process.env.PRISMA_MIGRATIONS_PATH ?? 'prisma/migrations',
    seed: 'tsx prisma/seed/index.ts',
  },
  ...(process.env.MIGRATION_DATABASE_URL
    ? { datasource: { url: env('MIGRATION_DATABASE_URL') } }
    : {}),
});
