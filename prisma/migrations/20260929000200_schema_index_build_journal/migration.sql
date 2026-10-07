CREATE TYPE "SchemaIndexBuildState" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

CREATE TABLE "schema_index_builds" (
    "id" UUID NOT NULL,
    "stageChecksum" CHAR(64) NOT NULL,
    "indexName" TEXT NOT NULL,
    "definitionHash" CHAR(64) NOT NULL,
    "definition" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "state" "SchemaIndexBuildState" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),
    "errorCode" VARCHAR(64),

    CONSTRAINT "schema_index_builds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "schema_index_builds_stageChecksum_indexName_attempt_key"
    ON "schema_index_builds"("stageChecksum", "indexName", "attempt");

CREATE INDEX "schema_index_builds_stageChecksum_state_idx"
    ON "schema_index_builds"("stageChecksum", "state");
