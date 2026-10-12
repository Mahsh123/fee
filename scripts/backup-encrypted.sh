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
: "${BACKUP_S3_PREFIX:=fee-platform}"
: "${AWS_DEFAULT_REGION:=us-east-1}"

# S3-compatible off-site storage is optional for local development, but all
# values must be supplied together. A partial configuration is an operator error.
s3_values_set=0
for value in "${BACKUP_S3_ENDPOINT:-}" "${BACKUP_S3_BUCKET:-}" "${AWS_ACCESS_KEY_ID:-}" "${AWS_SECRET_ACCESS_KEY:-}"; do
  if [ -n "$value" ]; then s3_values_set=$((s3_values_set + 1)); fi
done
if [ "$s3_values_set" -ne 0 ] && [ "$s3_values_set" -ne 4 ]; then
  echo 'S3 backup requires endpoint, bucket, access key ID, and secret access key together' >&2
  exit 2
fi

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

  if [ "$s3_values_set" -eq 4 ]; then
    object_prefix=${BACKUP_S3_PREFIX#/}
    object_prefix=${object_prefix%/}
    object_key=$(basename "$artifact")
    if [ -n "$object_prefix" ]; then object_key="$object_prefix/$object_key"; fi
    uploaded=0
    retry_delay=60
    attempt=1
    while [ "$attempt" -le 5 ]; do
      if aws --endpoint-url "$BACKUP_S3_ENDPOINT" --region "$AWS_DEFAULT_REGION" \
        s3 cp "$artifact" "s3://${BACKUP_S3_BUCKET%/}/$object_key" \
        --only-show-errors; then
        uploaded=1
        break
      fi
      echo "off-site upload attempt $attempt/5 failed for $(basename "$artifact"); encrypted local backup is retained" >&2
      if [ "$attempt" -lt 5 ]; then sleep "$retry_delay"; fi
      retry_delay=$((retry_delay * 2))
      attempt=$((attempt + 1))
    done
    if [ "$uploaded" -eq 1 ]; then
      echo "off-site encrypted backup uploaded: $(basename "$artifact")"
      printf '%s\n' "$stamp" > /backups/.last-offsite-upload.partial
      mv -- /backups/.last-offsite-upload.partial /backups/.last-offsite-upload
    else
      echo "off-site upload failed after 5 attempts; local encrypted backup is retained and operator alerting is required" >&2
    fi
  else
    echo 'off-site backup is not configured; this artifact exists only on the local Docker volume' >&2
  fi

  find /backups -type f -name 'feeplatform-*.dump.age' \
    -mtime "+${BACKUP_RETENTION_DAYS}" -delete
  sleep 86400
done
