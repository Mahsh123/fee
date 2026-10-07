-- A subject can be bound to at most one portal login per tenant. Null subject
-- columns remain available for ordinary staff accounts under PostgreSQL's
-- default NULL-distinct unique-index semantics.
CREATE UNIQUE INDEX IF NOT EXISTS "users_tenantId_studentId_key"
  ON "users" ("tenantId", "studentId");

CREATE UNIQUE INDEX IF NOT EXISTS "users_tenantId_guardianId_key"
  ON "users" ("tenantId", "guardianId");
