FROM postgres:17-alpine

RUN apk add --no-cache age aws-cli \
    && mkdir -p /backups \
    && chown postgres:postgres /backups \
    && chmod 0700 /backups

COPY scripts/backup-encrypted.sh /usr/local/bin/backup-encrypted.sh
RUN chmod 0555 /usr/local/bin/backup-encrypted.sh

USER postgres
ENTRYPOINT ["/usr/local/bin/backup-encrypted.sh"]
