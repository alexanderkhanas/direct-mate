#!/bin/bash
# DirectMate vsftpd container entrypoint.
#
# Replaces fauria/vsftpd's default `run-vsftpd.sh` (which would
# regenerate vsftpd.conf from FTP_USER/FTP_PASS env vars and clobber
# our mounted config). This script:
#   - Sanity-checks that the host-managed virtual users DB and per-user
#     conf dir are mounted.
#   - Launches vsftpd directly with PASV settings injected as `-o`
#     command-line overrides so they remain configurable via .env.

set -euo pipefail

DB=/etc/vsftpd/virtual_users.db
CONF_D=/etc/vsftpd/user_conf.d

[ -f "$DB" ] || { echo "[entrypoint] FATAL: $DB not mounted (need /srv/directmate-ftp/.config/virtual_users.db)" >&2; exit 1; }
[ -d "$CONF_D" ] || { echo "[entrypoint] FATAL: $CONF_D not mounted (need /srv/directmate-ftp/.config/user_conf.d)" >&2; exit 1; }

PASV_ADDRESS="${PASV_ADDRESS:-}"
[ -n "$PASV_ADDRESS" ] || { echo "[entrypoint] FATAL: PASV_ADDRESS env var required" >&2; exit 1; }

PASV_MIN="${PASV_MIN_PORT:-21100}"
PASV_MAX="${PASV_MAX_PORT:-21110}"
UMASK="${LOCAL_UMASK:-022}"

echo "[entrypoint] starting vsftpd (PASV ${PASV_ADDRESS}:${PASV_MIN}-${PASV_MAX}, umask ${UMASK})"

exec /usr/sbin/vsftpd \
  -opasv_address="${PASV_ADDRESS}" \
  -opasv_min_port="${PASV_MIN}" \
  -opasv_max_port="${PASV_MAX}" \
  -olocal_umask="${UMASK}" \
  /etc/vsftpd/vsftpd.conf
