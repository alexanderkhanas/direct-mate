#!/usr/bin/env bash
# Generate the FTP password for the luxespace_trs user, append it to
# infra/production/.env, and print the credentials block ONCE.
#
# Idempotent: if FTP_LUXESPACE_PASS is already set in .env, prints the
# existing credentials block instead of regenerating.
#
# Re-generate by removing the FTP_LUXESPACE_PASS line from .env and
# re-running this script.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/infra/production/.env"
USER_NAME="luxespace_trs"
HOST_DEFAULT="ftp.directmate.app"

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: ${ENV_FILE} not found. Copy .env.example to .env first." >&2
  exit 1
fi

# Read current value (if any). Strips surrounding quotes if present.
current_pass="$(grep -E '^FTP_LUXESPACE_PASS=' "${ENV_FILE}" | head -n1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' || true)"
pasv_address="$(grep -E '^FTP_PASV_ADDRESS=' "${ENV_FILE}" | head -n1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//' || true)"

if [ -n "${current_pass}" ]; then
  echo "FTP_LUXESPACE_PASS already set in .env — printing existing credentials."
  pass="${current_pass}"
else
  # 32 hex chars (128 bits of entropy). No shell-special chars so .env
  # quoting stays simple. openssl is preferable to /dev/urandom + head,
  # which trips SIGPIPE under `set -o pipefail`.
  pass="$(openssl rand -hex 16)"

  # If the line exists but is empty, replace it; otherwise append.
  if grep -qE '^FTP_LUXESPACE_PASS=' "${ENV_FILE}"; then
    # Use a tempfile to avoid sed -i portability issues across BSD/GNU.
    tmp="$(mktemp)"
    awk -v new="FTP_LUXESPACE_PASS=${pass}" '
      /^FTP_LUXESPACE_PASS=/ { print new; next }
      { print }
    ' "${ENV_FILE}" > "${tmp}"
    mv "${tmp}" "${ENV_FILE}"
  else
    printf '\nFTP_LUXESPACE_PASS=%s\n' "${pass}" >> "${ENV_FILE}"
  fi

  echo "OK: wrote FTP_LUXESPACE_PASS to ${ENV_FILE}"
fi

if [ -z "${pasv_address}" ]; then
  pasv_address="<set FTP_PASV_ADDRESS in .env first>"
fi

cat <<EOF

====================================
FTP CREDENTIALS FOR luxespace TENANT
Host: ${HOST_DEFAULT}
Port: 21
User: ${USER_NAME}
Pass: ${pass}
Sync file path:   /sync/    (TSGoods.trs goes here)
Images path:      /images/  (product photos)
PASV address:     ${pasv_address}
====================================

The chrooted FTP user sees / as their root, which maps to
/srv/directmate-ftp/luxespace on the host.

Save these credentials in your password manager — they will not be
printed again unless you delete FTP_LUXESPACE_PASS from .env.
EOF
