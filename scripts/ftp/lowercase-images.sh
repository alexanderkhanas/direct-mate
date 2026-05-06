#!/usr/bin/env bash
# Rename any FTP-uploaded image whose basename contains uppercase
# characters to its all-lowercase equivalent. Walks every tenant's
# /srv/directmate-ftp/<tenant>/images/ subtree.
#
# Why: the CDN nginx vhost (and the filesystem) is case-sensitive, but
# we want a uniform URL pattern (cdn.directmate.app/{tenant}/images/
# {GoodID}.jpg) so DirectMate / n8n can build URLs from CSV data without
# probing FTP for actual filenames.
#
# Idempotent: silent in steady state. Cron-friendly.
#
# Conflict handling when a lowercase target already exists:
#   - byte-identical → delete the uppercase original (cleanup)
#   - different content → log WARN and skip (no clobber)
#
# Run on the host, not in any container — uses bind-mount perspective.

set -euo pipefail

ROOT="/srv/directmate-ftp"
LOCK="/var/lock/directmate-lowercase.lock"

# Single-instance gate. Prevents overlapping runs if cron fires while a
# previous pass is still walking the tree (e.g. during a large Torgsoft
# sync that just landed thousands of files).
exec 9>"$LOCK"
flock -n 9 || { echo "$(date -Is) another instance running, exit"; exit 0; }

renamed=0
deleted=0
skipped=0

# `-name "*[A-Z]*"` matches files whose basename has any uppercase char.
# `-path "*/images/*"` confines the walk to per-tenant images dirs only,
# so /sync/ and any future siblings stay untouched.
while IFS= read -r -d '' src; do
    dir="$(dirname "$src")"
    base="$(basename "$src")"
    lower="$(echo "$base" | tr '[:upper:]' '[:lower:]')"

    # Defensive: find filter should preclude this, but check anyway.
    [ "$base" = "$lower" ] && continue

    dst="${dir}/${lower}"

    if [ ! -e "$dst" ]; then
        mv -- "$src" "$dst"
        echo "$(date -Is) renamed: ${src#"$ROOT/"} -> ${dst#"$ROOT/"}"
        renamed=$((renamed + 1))
    else
        src_md5=$(md5sum -- "$src" | awk '{print $1}')
        dst_md5=$(md5sum -- "$dst" | awk '{print $1}')
        if [ "$src_md5" = "$dst_md5" ]; then
            rm -- "$src"
            echo "$(date -Is) deleted duplicate: ${src#"$ROOT/"} (identical to ${dst#"$ROOT/"})"
            deleted=$((deleted + 1))
        else
            echo "$(date -Is) WARN skip: ${src#"$ROOT/"} — lowercase exists with different content"
            skipped=$((skipped + 1))
        fi
    fi
done < <(find "$ROOT" -type f -path "*/images/*" -name "*[A-Z]*" -print0 2>/dev/null)

# Steady-state silence: only emit a summary line when something actually
# happened. Keeps cron mail / log churn at zero on quiet runs.
if [ "$renamed" -gt 0 ] || [ "$deleted" -gt 0 ] || [ "$skipped" -gt 0 ]; then
    echo "$(date -Is) summary: renamed=$renamed deleted=$deleted skipped=$skipped"
fi
