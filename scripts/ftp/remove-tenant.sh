#!/usr/bin/env bash
# Remove an FTP tenant — revokes login + archives storage.
#
# Usage: sudo ./scripts/ftp/remove-tenant.sh <slug>
#
# Effects:
#   - Removes <slug>_trs from users.txt and regenerates virtual_users.db
#   - Removes per-user vsftpd conf
#   - mv /srv/directmate-ftp/<slug>/  →  /srv/directmate-ftp-archive/<slug>-<YYYY-MM-DD>/
#
# Storage is *moved*, not deleted. To purge, an operator manually
# `rm -rf` the archive directory after confirming nothing references it.

set -euo pipefail

SLUG="${1:-}"
[ -n "$SLUG" ] || { echo "usage: $0 <slug>" >&2; exit 64; }
[ "$(id -u)" -eq 0 ] || { echo "ERROR: must run as root" >&2; exit 77; }

ROOT=/srv/directmate-ftp
ARCHIVE_ROOT=/srv/directmate-ftp-archive
CONFIG="$ROOT/.config"
USERS="$CONFIG/users.txt"
DB="$CONFIG/virtual_users.db"
USER_CONF_DIR="$CONFIG/user_conf.d"
LOGIN="${SLUG}_trs"
STORAGE="$ROOT/$SLUG"
DATE="$(date -u +%Y-%m-%d)"
ARCHIVE_DIR="$ARCHIVE_ROOT/$SLUG-$DATE"

# At least one piece of state must exist to consider this a real
# tenant — guards against typos.
if ! grep -qx "$LOGIN" "$USERS" 2>/dev/null \
  && [ ! -e "$STORAGE" ] \
  && [ ! -e "$USER_CONF_DIR/$LOGIN" ]; then
  echo "ERROR: tenant '$SLUG' not found (no users.txt entry, no storage, no user conf)" >&2
  exit 73
fi

regen_db() {
  docker run --rm \
    -v "$CONFIG":/work \
    --entrypoint /usr/bin/db_load \
    fauria/vsftpd \
    -T -t hash -f /work/users.txt /work/virtual_users.db.new >/dev/null

  cat "$CONFIG/virtual_users.db.new" > "$DB"
  rm -f "$CONFIG/virtual_users.db.new"
  chmod 600 "$DB"
}

# --- 1. drop login from users.txt + regen .db ---
# users.txt format is alternating lines: username, password, username, password, …
# Find the username's line and delete that line + the next (its password).
if grep -qx "$LOGIN" "$USERS" 2>/dev/null; then
  awk -v u="$LOGIN" '
    BEGIN { skip = 0 }
    skip > 0 { skip--; next }
    $0 == u { skip = 1; next }
    { print }
  ' "$USERS" > "$USERS.tmp"
  mv "$USERS.tmp" "$USERS"
  chmod 600 "$USERS"
  regen_db
  echo "removed $LOGIN from $USERS, regenerated $DB"
else
  echo "(no $LOGIN entry in $USERS — skipping db regen)"
fi

# --- 2. drop per-user vsftpd conf ---
if [ -e "$USER_CONF_DIR/$LOGIN" ]; then
  rm -f "$USER_CONF_DIR/$LOGIN"
  echo "removed $USER_CONF_DIR/$LOGIN"
fi

# --- 3. archive storage tree ---
if [ -e "$STORAGE" ]; then
  mkdir -p "$ARCHIVE_ROOT"
  # If a same-day archive already exists (re-running on the same day
  # after manual restore, etc.), append a counter suffix.
  if [ -e "$ARCHIVE_DIR" ]; then
    n=2
    while [ -e "$ARCHIVE_DIR-$n" ]; do n=$((n + 1)); done
    ARCHIVE_DIR="$ARCHIVE_DIR-$n"
  fi
  mv "$STORAGE" "$ARCHIVE_DIR"
  echo "archived storage: $STORAGE → $ARCHIVE_DIR"
else
  echo "(no $STORAGE — skipping archive)"
fi

cat <<EOF

Tenant '$SLUG' removed.
  - FTP login revoked (next auth attempt with $LOGIN will fail)
  - Storage moved to: $ARCHIVE_DIR
  - To permanently delete: rm -rf "$ARCHIVE_DIR"
EOF
