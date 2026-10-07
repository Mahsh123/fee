#!/bin/sh
set -eu
set -o pipefail

: "${PGHOST:?PGHOST must be set}"
: "${PGPORT:?PGPORT must be set}"
: "${PGUSER:?PGUSER must be set to the read-only backup role}"
: "${PGPASSWORD:?PGPASSWORD must be set}"
: "${PGDATABASE:?PGDATABASE must be set}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT must be set}"
: "${BACKUP_RETENTION_DAYS:=30}"

case "$BACKUP_RETENTION_DAYS" in
  ''|*[!0-9]*) echo 'BACKUP_RETENTION_DAYS must be a positive integer' >&2; exit 2 ;;
esac
if [ "$BACKUP_RETENTION_DAYS" -lt 1 ]; then
  echo 'BACKUP_RETENTION_DAYS must be a positive integer' >&2
  exit 2
fi

umask 077
temporary_file=''
cleanup() {
  if [ -n "$temporary_file" ]; then rm -f -- "$temporary_file"; fi
}
trap cleanup EXIT
trap 'cleanup; exit 1' HUP INT TERM

while :; do
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  artifact="/backups/feeplatform-${stamp}.dump.age"
  temporary_file="${artifact}.partial"

  # The pipe is fail-fast: neither a failed dump nor failed encryption may be
  # accepted as a valid artifact. Plaintext only flows between the processes.
  pg_dump --format=custom --compress=9 --file=- \
    | age --encrypt --recipient "$BACKUP_AGE_RECIPIENT" --output "$temporary_file"

  chmod 0600 "$temporary_file"
  mv -- "$temporary_file" "$artifact"
  temporary_file=''
  echo "encrypted backup written: $(basename "$artifact")"

  find /backups -type f -name 'feeplatform-*.dump.age' \
    -mtime "+${BACKUP_RETENTION_DAYS}" -delete
  sleep 86400
done
