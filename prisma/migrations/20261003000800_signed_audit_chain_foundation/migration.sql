-- Additive schema foundation for the signed, sequenced v2 audit chain.
-- Legacy audit rows and their hashes are not rewritten by this migration.
CREATE TABLE "app_schema_capabilities" (
  "key" TEXT NOT NULL,
  CONSTRAINT "app_schema_capabilities_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "audit_logs"
  ADD COLUMN "hashVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "chainSequence" BIGINT,
  ADD COLUMN "appendNonce" UUID,
  ADD COLUMN "canonicalPayload" TEXT,
  ADD CONSTRAINT "audit_logs_hash_version_check" CHECK ("hashVersion" IN (1, 2)),
  ADD CONSTRAINT "audit_logs_versioned_chain_fields_check" CHECK (
    ("hashVersion" = 1 AND "chainSequence" IS NULL AND "appendNonce" IS NULL AND "canonicalPayload" IS NULL)
    OR
    ("hashVersion" = 2 AND "chainSequence" IS NOT NULL AND "chainSequence" > 0 AND "appendNonce" IS NOT NULL
      AND "canonicalPayload" IS NOT NULL AND "hash" IS NOT NULL)
  );

CREATE UNIQUE INDEX "audit_logs_tenant_chain_sequence_key"
  ON "audit_logs"("tenantId", "chainSequence");
CREATE UNIQUE INDEX "audit_logs_tenant_append_nonce_key"
  ON "audit_logs"("tenantId", "appendNonce");

CREATE TABLE "audit_chain_heads" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "lastSequence" BIGINT NOT NULL DEFAULT 0,
  "lastHash" TEXT,
  "legacySnapshotHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "audit_chain_heads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_chain_heads_tenant_id_key" UNIQUE ("tenantId"),
  CONSTRAINT "audit_chain_heads_tenant_id_id_key" UNIQUE ("tenantId", "id"),
  CONSTRAINT "audit_chain_heads_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "audit_chain_heads_sequence_nonnegative_check" CHECK ("lastSequence" >= 0),
  CONSTRAINT "audit_chain_heads_hash_presence_check" CHECK (("lastSequence" = 0) = ("lastHash" IS NULL))
);

-- Existing tenants get an empty head now. The exclusive cutover migration will
-- calculate each legacy snapshot anchor under the shared audit append lock.
INSERT INTO "audit_chain_heads" ("id", "tenantId", "lastSequence", "lastHash", "legacySnapshotHash", "updatedAt")
SELECT gen_random_uuid(), tenant."id", 0, NULL, NULL, CURRENT_TIMESTAMP
FROM "tenants" AS tenant
ON CONFLICT ("tenantId") DO NOTHING;

CREATE TABLE "audit_signing_keys" (
  "keyVersion" INTEGER NOT NULL,
  "keyMaterial" BYTEA NOT NULL,
  "notBefore" TIMESTAMP(3) NOT NULL,
  "notAfter" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_signing_keys_pkey" PRIMARY KEY ("keyVersion"),
  CONSTRAINT "audit_signing_keys_version_positive_check" CHECK ("keyVersion" > 0),
  CONSTRAINT "audit_signing_keys_material_length_check" CHECK (octet_length("keyMaterial") = 32),
  CONSTRAINT "audit_signing_keys_window_check" CHECK ("notAfter" IS NULL OR "notAfter" > "notBefore"),
  CONSTRAINT "audit_signing_keys_retirement_check" CHECK ("retiredAt" IS NULL OR "retiredAt" >= "notBefore")
);

CREATE TABLE "audit_request_nonces" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "requestNonce" UUID NOT NULL,
  "signingKeyVersion" INTEGER NOT NULL,
  "transactionId" BIGINT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_request_nonces_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "audit_request_nonces_tenant_id_id_key" UNIQUE ("tenantId", "id"),
  CONSTRAINT "audit_request_nonces_tenant_request_nonce_key" UNIQUE ("tenantId", "requestNonce"),
  CONSTRAINT "audit_request_nonces_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "audit_request_nonces_signing_key_fkey"
    FOREIGN KEY ("signingKeyVersion") REFERENCES "audit_signing_keys"("keyVersion") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "audit_request_nonces_validity_window_check" CHECK ("expiresAt" > "issuedAt")
);
CREATE INDEX "audit_request_nonces_expiry_key_idx"
  ON "audit_request_nonces"("expiresAt", "signingKeyVersion");

-- The non-login audit owner receives only the row operations required by the
-- future signed append, verification, head-provisioning, and expiry routines.
-- Runtime access remains revoked by the staged ACL synchronizer.
GRANT SELECT, INSERT ON TABLE "audit_logs" TO fee_audit_owner;
GRANT SELECT, INSERT, UPDATE ON TABLE "audit_chain_heads" TO fee_audit_owner;
GRANT SELECT ON TABLE "audit_signing_keys" TO fee_audit_owner;
GRANT SELECT, INSERT, DELETE ON TABLE "audit_request_nonces" TO fee_audit_owner;
