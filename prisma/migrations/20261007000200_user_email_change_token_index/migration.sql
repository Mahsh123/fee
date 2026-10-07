-- Keep token uniqueness while avoiding a write-blocking table scan during rollout.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "users_emailChangeTokenHash_key"
  ON "users"("emailChangeTokenHash");
