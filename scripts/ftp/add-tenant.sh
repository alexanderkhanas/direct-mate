#!/usr/bin/env bash
# Add a new FTP tenant.
#
# Usage: sudo ./scripts/ftp/add-tenant.sh <slug>
#
# slug: lowercase [a-z0-9-]+, max 32 chars, no leading/trailing dash.
# FTP login = <slug>_trs. Storage at /srv/directmate-ftp/<slug>/{sync,images}.
# CDN URL prefix = https://cdn.directmate.app/<slug>/images/.
#
# Idempotency: refuses to act if the tenant already exists. Crash-safe
# via a single rollback trap that undoes any partial state on error.

set -euo pipefail

SLUG="${1:-}"
[ -n "$SLUG" ] || { echo "usage: $0 <slug>" >&2; exit 64; }

# Slug validation. ^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$ — covers lowercase
# alphanumeric + dashes, 1–32 chars, no leading/trailing dash.
if ! [[ "$SLUG" =~ ^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$ ]]; then
  echo "ERROR: invalid slug '$SLUG'" >&2
  echo "  rules: lowercase, [a-z0-9-]+, max 32 chars, no leading/trailing dash" >&2
  exit 64
fi

[ "$(id -u)" -eq 0 ] || { echo "ERROR: must run as root" >&2; exit 77; }

ROOT=/srv/directmate-ftp
CONFIG="$ROOT/.config"
USERS="$CONFIG/users.txt"
DB="$CONFIG/virtual_users.db"
USER_CONF_DIR="$CONFIG/user_conf.d"
LOGIN="${SLUG}_trs"
STORAGE="$ROOT/$SLUG"

# --- pre-flight: refuse if anything for this slug already exists ---
if grep -qx "$LOGIN" "$USERS" 2>/dev/null; then
  echo "ERROR: tenant '$SLUG' already exists in $USERS" >&2
  exit 73
fi
if [ -e "$STORAGE" ]; then
  echo "ERROR: storage path $STORAGE already exists" >&2
  exit 73
fi
if [ -e "$USER_CONF_DIR/$LOGIN" ]; then
  echo "ERROR: user conf $USER_CONF_DIR/$LOGIN already exists" >&2
  exit 73
fi

# --- rollback trap: any failure after this point undoes partial state ---
created_storage=false
appended_users=false
wrote_user_conf=false

rollback() {
  set +e
  echo "[add-tenant] rolling back partial state…" >&2
  if $appended_users; then
    # Remove the trailing two-line block we appended.
    head -n -2 "$USERS" > "$USERS.rollback" && mv "$USERS.rollback" "$USERS"
    chmod 600 "$USERS"
    # Best-effort regen — if this fails too, operator needs to fix manually.
    regen_db || echo "[add-tenant] WARN: failed to regen $DB during rollback" >&2
  fi
  if $wrote_user_conf; then rm -f "$USER_CONF_DIR/$LOGIN"; fi
  if $created_storage; then rm -rf "$STORAGE"; fi
  echo "[add-tenant] rollback complete" >&2
}
trap '[ "$?" -ne 0 ] && rollback' EXIT

# --- helpers ---
regen_db() {
  # Run db_load inside the same fauria/vsftpd image so BDB version
  # matches what vsftpd reads at runtime. Write to a tmp path then
  # `cat` over the existing .db so the inode is preserved (the
  # container has the file bind-mounted and a `mv` would orphan it).
  docker run --rm \
    -v "$CONFIG":/work \
    --entrypoint /usr/bin/db_load \
    fauria/vsftpd \
    -T -t hash -f /work/users.txt /work/virtual_users.db.new >/dev/null

  cat "$CONFIG/virtual_users.db.new" > "$DB"
  rm -f "$CONFIG/virtual_users.db.new"
  chmod 600 "$DB"
}

# --- generate password ---
PASS="$(openssl rand -hex 16)"

# --- 1. storage tree (matches vsftpd container's `ftp` user UID 14:80) ---
mkdir -p "$STORAGE/sync" "$STORAGE/images"
chown -R 14:80 "$STORAGE"
chmod 755 "$STORAGE" "$STORAGE/sync" "$STORAGE/images"
created_storage=true

# --- 2. per-user vsftpd conf (overrides chroot to tenant tree) ---
cat > "$USER_CONF_DIR/$LOGIN" <<EOF
local_root=/srv/directmate-ftp/$SLUG
write_enable=YES
allow_writeable_chroot=YES
EOF
chmod 644 "$USER_CONF_DIR/$LOGIN"
wrote_user_conf=true

# --- 3. append to users.txt + regen .db ---
printf '%s\n%s\n' "$LOGIN" "$PASS" >> "$USERS"
chmod 600 "$USERS"
appended_users=true
regen_db

# Disarm the rollback trap — everything succeeded.
trap - EXIT

# --- 4. credentials block ---
cat <<EOF

====================================
FTP CREDENTIALS for tenant: $SLUG
Host: ftp.directmate.app
Port: 21
Login: $LOGIN
Password: $PASS
Sync upload path: /sync/
Images upload path: /images/
Image URL prefix: https://cdn.directmate.app/$SLUG/images/
====================================

Save these credentials in your password manager — they are NOT stored
anywhere recoverable. Re-running this script will refuse (tenant
exists). To rotate the password, run remove-tenant.sh then re-add.
EOF
