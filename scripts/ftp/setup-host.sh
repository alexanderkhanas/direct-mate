#!/usr/bin/env bash
# Prepare host filesystem for the vsftpd container's bind mount.
# Idempotent: safe to re-run.
#
# Creates /srv/directmate-ftp/luxespace/{sync,images} and chowns to the
# UID/GID used by the fauria/vsftpd container's `ftp` user (14:80).
# That UID is what files written via FTP will be owned as on the host.
#
# Run as root (or with sudo) since it touches /srv and chowns.

set -euo pipefail

ROOT="/srv/directmate-ftp/luxespace"
FTP_UID=14
FTP_GID=80

if [ "$(id -u)" -ne 0 ]; then
  echo "ERROR: must run as root (use sudo)" >&2
  exit 1
fi

mkdir -p "${ROOT}/sync" "${ROOT}/images"

chown -R "${FTP_UID}:${FTP_GID}" "${ROOT}"
chmod 755 "${ROOT}" "${ROOT}/sync" "${ROOT}/images"

echo "OK: ${ROOT}/{sync,images} present, owner ${FTP_UID}:${FTP_GID}, mode 755"
