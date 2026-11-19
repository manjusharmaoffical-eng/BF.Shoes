#!/usr/bin/env sh
set -eu
: "${BF_SHOES_BASE_URL:?Set BF_SHOES_BASE_URL to the HTTPS BF SHOES origin}"
: "${CRON_SECRET:?Set CRON_SECRET in the protected scheduler environment}"
case "$BF_SHOES_BASE_URL" in https://*) ;; *) echo "BF_SHOES_BASE_URL must use HTTPS" >&2; exit 2;; esac
# Supply the bearer secret through curl's stdin config, not its process arguments or URL.
printf 'header = "Authorization: Bearer %s"\n' "$CRON_SECRET" |
  curl --config - --fail --silent --show-error --max-time 30 \
    "${BF_SHOES_BASE_URL%/}/api/cron/email-outbox"
