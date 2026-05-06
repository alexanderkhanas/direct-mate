#!/usr/bin/env bash
# List all configured FTP tenants and basic disk stats.
#
# Usage: sudo ./scripts/ftp/list-tenants.sh
#
# Read-only. No secrets in output. Iterates over the per-user conf
# files (the source of truth for "this tenant is active") rather than
# users.txt, so any drift between the two surfaces explicitly.

set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "ERROR: must run as root" >&2; exit 77; }

ROOT=/srv/directmate-ftp
CONFIG="$ROOT/.config"
USERS="$CONFIG/users.txt"
USER_CONF_DIR="$CONFIG/user_conf.d"

if [ ! -d "$USER_CONF_DIR" ]; then
  echo "no $USER_CONF_DIR — run a migration first"
  exit 0
fi

# Format: slug | login | storage | size | last sync mtime | drift?
printf '%-20s %-22s %-32s %-10s %-25s %s\n' \
  SLUG LOGIN STORAGE SIZE LAST_SYNC_MTIME NOTES
printf '%-20s %-22s %-32s %-10s %-25s %s\n' \
  -------------------- ---------------------- -------------------------------- ---------- ------------------------- -----

shopt -s nullglob
for conf in "$USER_CONF_DIR"/*; do
  login=$(basename "$conf")
  # Convention: login = <slug>_trs. Strip the suffix to get slug.
  slug="${login%_trs}"
  if [ "$slug" = "$login" ]; then
    # Doesn't follow our convention — show login as-is and slug = "?".
    slug="?"
  fi
  storage=$(grep -E '^local_root=' "$conf" | head -n1 | cut -d= -f2-)
  storage="${storage:-?}"

  if [ -d "$storage" ]; then
    size=$(du -sh "$storage" 2>/dev/null | awk '{print $1}')
  else
    size="(missing)"
  fi

  if [ -d "$storage/sync" ]; then
    # Most-recently-modified file inside /sync/ (tells operator when
    # Torgsoft last pushed). Falls back to dir mtime if empty.
    last_sync=$(find "$storage/sync" -type f -printf '%T@\n' 2>/dev/null \
      | sort -nr | head -n1)
    if [ -n "$last_sync" ]; then
      last_sync=$(date -u -d "@$last_sync" +'%Y-%m-%dT%H:%M:%SZ' 2>/dev/null)
    else
      last_sync="(empty)"
    fi
  else
    last_sync="(no /sync/)"
  fi

  notes=""
  if ! grep -qx "$login" "$USERS" 2>/dev/null; then
    notes="DRIFT: not in users.txt"
  fi

  printf '%-20s %-22s %-32s %-10s %-25s %s\n' \
    "$slug" "$login" "$storage" "$size" "$last_sync" "$notes"
done

# Also surface entries that ARE in users.txt but have no per-user conf
# (the inverse drift case).
if [ -f "$USERS" ]; then
  while read -r u && read -r _; do
    [ -z "$u" ] && continue
    if [ ! -f "$USER_CONF_DIR/$u" ]; then
      printf '%-20s %-22s %-32s %-10s %-25s %s\n' \
        "?" "$u" "?" "-" "-" "DRIFT: in users.txt, no user_conf.d entry"
    fi
  done < "$USERS"
fi
