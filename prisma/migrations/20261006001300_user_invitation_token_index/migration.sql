-- The invitation hash is nullable for existing and active users. Build its
-- uniqueness index concurrently so invitation rollout does not lock the user
-- table for the duration of an index scan.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "users_invitationTokenHash_key"
  ON "users"("invitationTokenHash");
