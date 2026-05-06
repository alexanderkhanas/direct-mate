# FTP receiving endpoint (multi-tenant Torgsoft sync)

vsftpd container running in **virtual users** mode at
`ftp.directmate.app`. Each tenant gets one FTP login, chrooted to its
own storage tree at `/srv/directmate-ftp/<slug>/`. Adding or removing
a tenant is a single CLI command — no container rebuild, no daemon
restart.

- Image: `fauria/vsftpd` (with custom entrypoint at
  [infra/production/vsftpd/entrypoint.sh](../../infra/production/vsftpd/entrypoint.sh))
- Service name: `ftp` (in
  [infra/production/docker-compose.prod.yml](../../infra/production/docker-compose.prod.yml))
- Subdomain: `ftp.directmate.app` (DNS already configured)
- Tenant URL pattern (CDN): `https://cdn.directmate.app/<slug>/images/<file>`
- Login pattern: `<slug>_trs` (Torgsoft naming convention)

## Adding a new tenant

The operator workflow you'll do most often. Single command, prints
credentials to give to the Torgsoft operator on the client's PC.

```bash
sudo /opt/directmate/scripts/ftp/add-tenant.sh <slug>
```

Slug rules: lowercase, `[a-z0-9-]+`, max 32 chars, no leading/trailing
dash. Refuses if the tenant already exists.

What it does:

1. Creates `/srv/directmate-ftp/<slug>/{sync,images}/` (mode 755, owner
   `ftp:ftp` = UID 14:80 inside the container).
2. Generates a 32-char hex password (alphanumeric, no special chars
   that break FTP clients).
3. Appends `<slug>_trs` to `/srv/directmate-ftp/.config/users.txt` and
   regenerates `virtual_users.db`. `pam_userdb` opens the DB on every
   auth, so new logins work **immediately** — no daemon restart.
4. Writes per-user vsftpd conf at
   `/srv/directmate-ftp/.config/user_conf.d/<slug>_trs` setting
   `local_root` to the tenant's storage tree.
5. Prints credentials block to stdout in the exact format the
   Torgsoft operator needs:

```
====================================
FTP CREDENTIALS for tenant: <slug>
Host: ftp.directmate.app
Port: 21
Login: <slug>_trs
Password: <generated>
Sync upload path: /sync/
Images upload path: /images/
Image URL prefix: https://cdn.directmate.app/<slug>/images/
====================================
```

**Failure handling**: any partial state (created dirs, written conf,
appended user) is rolled back automatically if a later step fails.

## Verifying a new tenant works

After running `add-tenant.sh <slug>`, from your laptop:

```bash
# 1. Login + upload to /images/
echo "test" > /tmp/test.jpg
curl -u "<slug>_trs:<password>" -T /tmp/test.jpg \
  "ftp://ftp.directmate.app/images/test.jpg"

# 2. CDN can reach it (1-day cache + CORS already in place)
curl -I "https://cdn.directmate.app/<slug>/images/test.jpg"
# Expect: HTTP/2 200, content-type: image/jpeg

# 3. (on VPS) file is mode 644, owner 14
ssh root@<VPS> 'ls -la /srv/directmate-ftp/<slug>/images/test.jpg'

# 4. Tenant isolation: this tenant cannot see other tenants' trees
curl -u "<slug>_trs:<password>" ftp://ftp.directmate.app/
# Expect: only sync/ and images/, NOT other tenant slugs
```

When the test is done, hand the credentials block to the operator who
configures Torgsoft on the client's PC. Default Torgsoft sync object
fields:

| Torgsoft field | Value |
|---|---|
| Адреса (host) | `ftp.directmate.app` |
| Порт | `21` |
| Користувач (login) | `<slug>_trs` |
| Пароль | (generated) |
| Шлях до файлів синхро. | `/sync` |
| Шлях до зображень | `/images` |
| Режим передачі | `passive` |

## Removing a tenant

```bash
sudo /opt/directmate/scripts/ftp/remove-tenant.sh <slug>
```

What it does:

1. Drops `<slug>_trs` from `users.txt`, regenerates `virtual_users.db`.
   Next auth attempt fails with `530 Login incorrect`.
2. Removes the per-user vsftpd conf file.
3. **Moves** (not deletes) `/srv/directmate-ftp/<slug>/` to
   `/srv/directmate-ftp-archive/<slug>-YYYY-MM-DD/`. Files are
   recoverable; permanent deletion is a separate manual step:
   ```bash
   rm -rf /srv/directmate-ftp-archive/<slug>-YYYY-MM-DD
   ```

The CDN URL (`cdn.directmate.app/<slug>/images/...`) returns 404 once
storage is moved, since nginx serves directly from the (now-empty)
`/srv/directmate-ftp/<slug>/` path.

## Listing tenants

```bash
sudo /opt/directmate/scripts/ftp/list-tenants.sh
```

Output (read-only, no secrets):

```
SLUG          LOGIN            STORAGE                         SIZE   LAST_SYNC_MTIME           NOTES
luxespace     luxespace_trs    /srv/directmate-ftp/luxespace   1.3G   2026-05-06T15:00:43Z
testclient    testclient_trs   /srv/directmate-ftp/testclient  16K    (empty)
```

`LAST_SYNC_MTIME` is the most recent mtime of any file in `<storage>/sync/`
— a good proxy for "did this tenant push anything lately?".

`NOTES` flags drift between `users.txt` and `user_conf.d/` (rare but
makes config issues visible).

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ infra/production/vsftpd/        (repo, deployed via rsync)   │
│ ├── vsftpd.conf      ← static config, mounted RO into        │
│ │                      container at /etc/vsftpd/vsftpd.conf  │
│ └── entrypoint.sh    ← bypasses fauria's env-var generator;  │
│                        execs vsftpd with PASV settings as    │
│                        runtime -o overrides                  │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ /srv/directmate-ftp/.config/      (VPS, operator-managed)    │
│ ├── users.txt              ← src of truth: alternating       │
│ │                            username + password lines       │
│ ├── virtual_users.db       ← BDB hash regenerated by         │
│ │                            add-/remove-tenant.sh           │
│ └── user_conf.d/<login>    ← per-user local_root override    │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ /srv/directmate-ftp/<slug>/       (tenant storage)           │
│ ├── sync/      ← TSGoods.trs lands here                      │
│ └── images/    ← product photos; served by cdn.directmate.app│
└──────────────────────────────────────────────────────────────┘
```

Why virtual users (vs system accounts):

- **No system user creation per tenant** — adding a tenant is a config
  change, not a host-level user mutation.
- **No daemon restart on add/remove** — `pam_userdb` re-reads the BDB
  file on every auth.
- **Single chroot mechanism** — `local_root` per user via
  `user_config_dir`, no per-tenant volume mount in compose.

Why a custom entrypoint (vs fauria's default):

- The default entrypoint regenerates `vsftpd.conf` from `FTP_USER` /
  `FTP_PASS` env vars on every start, clobbering our virtual-users
  config.
- Our entrypoint validates the host-managed configs are mounted, then
  execs `vsftpd` directly with `pasv_*` and `local_umask` passed as
  `-o key=value` runtime overrides so they remain configurable via
  `.env`.

## Inspecting virtual_users.db (debugging)

```bash
# Dump all users + plaintext passwords (root-only on VPS).
docker run --rm -v /srv/directmate-ftp/.config:/work \
  --entrypoint /usr/bin/db_dump fauria/vsftpd \
  -p /work/virtual_users.db
```

Output is BDB hash `print` format: alternating `username` + `password`
keys. Compare with `users.txt` to detect drift (the regen scripts
should keep them aligned, but a manual edit to `users.txt` without
regen would diverge).

To regenerate manually after editing `users.txt` directly:

```bash
docker run --rm -v /srv/directmate-ftp/.config:/work \
  --entrypoint /usr/bin/db_load fauria/vsftpd \
  -T -t hash -f /work/users.txt /work/virtual_users.db.new \
  && cat /srv/directmate-ftp/.config/virtual_users.db.new \
       > /srv/directmate-ftp/.config/virtual_users.db \
  && rm /srv/directmate-ftp/.config/virtual_users.db.new
```

(The `cat ... >` pattern preserves the inode the container is bind-
mounted against; a `mv` would orphan it.)

## Per-user conf file format

Each file at `/srv/directmate-ftp/.config/user_conf.d/<login>` is a
standard vsftpd config snippet. Minimum required:

```
local_root=/srv/directmate-ftp/<slug>
write_enable=YES
allow_writeable_chroot=YES
```

The filename must exactly match the FTP login (e.g. `luxespace_trs`).
Filenames are case-sensitive and must match what's in `users.txt`.

## First-time bootstrap on a fresh VPS

Required only when standing up a brand-new VPS. Steady-state operators
on an existing VPS should not need this section.

### 1. DNS + firewall

```
ftp.directmate.app  A  <VPS public IPv4>
```

Open these ports inbound (TCP) in the Hetzner cloud firewall:

- `21` (FTP control channel)
- `21100-21110` (passive-mode data channels)

### 2. Configure `.env`

Edit `infra/production/.env`:

```
FTP_PASV_ADDRESS=<VPS public IPv4>
```

The legacy `FTP_LUXESPACE_PASS` env var is **no longer read by
docker-compose** since we migrated to virtual users mode. It's
retained in `.env` as historical audit data; the source of truth for
tenant passwords is now `/srv/directmate-ftp/.config/users.txt` on the
VPS.

### 3. Initialize `.config/`

```bash
sudo mkdir -p /srv/directmate-ftp/.config/user_conf.d
sudo chmod 700 /srv/directmate-ftp/.config
sudo chmod 755 /srv/directmate-ftp/.config/user_conf.d

# Empty users.txt + empty virtual_users.db so vsftpd can start.
sudo touch /srv/directmate-ftp/.config/users.txt
sudo chmod 600 /srv/directmate-ftp/.config/users.txt
sudo docker run --rm -v /srv/directmate-ftp/.config:/work \
  --entrypoint /usr/bin/db_load fauria/vsftpd \
  -T -t hash -f /work/users.txt /work/virtual_users.db
sudo chmod 600 /srv/directmate-ftp/.config/virtual_users.db
```

### 4. Bring up the ftp service

```bash
cd /opt/directmate/infra/production
docker compose -f docker-compose.prod.yml up -d ftp
```

### 5. Add tenants

```bash
sudo /opt/directmate/scripts/ftp/add-tenant.sh <slug>
```

…and you're back at the "Adding a new tenant" section above.

## Notes for the existing `luxespace` tenant

`luxespace` was migrated from the legacy single-user mode (where its
credentials lived in `docker-compose.yml`'s `FTP_USER`/`FTP_PASS` env
vars) to virtual users mode in this PR. The migration:

- Reused the **exact same password** that was already in
  `FTP_LUXESPACE_PASS` — the Torgsoft client on the customer's PC
  needs no change.
- Reused the existing storage tree at
  `/srv/directmate-ftp/luxespace/`.
- Required no operator action on the customer's side.

If you ever need to rotate `luxespace`'s password, run
`remove-tenant.sh luxespace` then `add-tenant.sh luxespace` and hand
the new credentials to the customer's Torgsoft operator. Storage is
preserved across the cycle (archived to `directmate-ftp-archive/` on
remove, then re-created empty on re-add — manually `cp` the data back
if you want to keep it).

## Lowercase rename cron

The CDN at `cdn.directmate.app` is case-sensitive (the filesystem is
case-sensitive and nginx serves files by exact name). Torgsoft
occasionally uploads with mixed-case extensions (`.JPG`, `.JPEG`),
which would force every URL builder to look up exact filenames.

`scripts/ftp/lowercase-images.sh` walks every tenant's
`/srv/directmate-ftp/<tenant>/images/` and renames any file with an
uppercase character in its basename to all-lowercase. Idempotent.
Cron-friendly (silent in steady state). Single-instance via `flock`.

The script's `find` pattern is `/srv/directmate-ftp/*/images/` so it
auto-covers any new tenant added via `add-tenant.sh` — no per-tenant
configuration needed.

Conflict handling when a lowercase target already exists:
- byte-identical → delete the uppercase original (cleanup)
- different content → log `WARN` and skip (no clobber)

### One-time setup (operator)

```bash
# Install cron entry (root). Idempotent — re-running won't duplicate.
( crontab -l 2>/dev/null | grep -v -F "lowercase-images.sh" \
  ; echo "*/5 * * * * /opt/directmate/scripts/ftp/lowercase-images.sh >> /var/log/directmate-lowercase.log 2>&1" \
) | crontab -

# Create the log file with proper perms (cron will append).
sudo touch /var/log/directmate-lowercase.log
sudo chmod 644 /var/log/directmate-lowercase.log

# Install logrotate config (weekly, keep 4).
sudo cp /opt/directmate/scripts/ftp/logrotate.conf /etc/logrotate.d/directmate-lowercase
sudo logrotate -d /etc/logrotate.d/directmate-lowercase  # dry-run sanity check
```

### Manual cleanup pass

```bash
sudo /opt/directmate/scripts/ftp/lowercase-images.sh
```

### Verifying the cron is doing something

```bash
# Watch the log
tail -f /var/log/directmate-lowercase.log

# Confirm zero remaining uppercase files
find /srv/directmate-ftp -type f -path "*/images/*" -name "*[A-Z]*" | wc -l
# → should be 0

# Confirm the cron is registered
sudo crontab -l | grep lowercase-images
```

## Troubleshooting

- **`ls` hangs after login**: passive ports `21100-21110` aren't
  reachable. Check Hetzner firewall + that `FTP_PASV_ADDRESS` matches
  the public IP.
- **`530 Login incorrect`**:
  - Wrong password (`add-tenant.sh` only prints once — check the
    operator's saved credentials).
  - User missing from `virtual_users.db` —
    `list-tenants.sh` will show drift; manually re-run
    `add-tenant.sh` after removing partial state.
- **CDN returns 403 (not 404)**: bind-mount of the FTP storage tree
  into the nginx container doesn't have the file. Confirm the file is
  mode 644 — `LOCAL_UMASK=022` on the ftp service makes new uploads
  644 by default.
- **CDN returns 200 for a file we just deleted**: the CDN cache header
  is `public, max-age=86400`. Either wait 24 h or invalidate at the
  client.
- **Container restart loop**: `docker compose logs ftp` — likely a
  missing required env var (`FTP_PASV_ADDRESS` empty) or a missing
  bind mount (`/srv/directmate-ftp/.config/virtual_users.db` not
  present — run the bootstrap above).
- **vsftpd log inside container**:
  ```bash
  docker exec production-ftp-1 tail -f /var/log/vsftpd.log
  ```
  Per-session: `OK LOGIN`, `OK UPLOAD`, `OK DOWNLOAD`, `FAIL LOGIN`.

## Why no FTPS?

Torgsoft only supports plain FTP. Mitigations for v1:

- Strong randomly-generated password per tenant (32 hex chars =
  128 bits of entropy).
- Firewall locked to FTP ports only.
- Each user chrooted to their own storage tree, no shell.
- No backend integration consumes credentials directly — the FTP
  server only receives writes; downstream consumers (n8n, CDN) read
  from disk.

If FTPS becomes required (or a non-Torgsoft client lands), revisit by
enabling vsftpd's TLS support in `vsftpd.conf` and minting a cert via
the existing certbot service (the `cdn.directmate.app` cert flow is
the template).

## Legacy scripts (superseded)

- `setup-host.sh` — created `/srv/directmate-ftp/luxespace/{sync,images}`
  for the original single-user setup. **Superseded by `add-tenant.sh`**;
  retained for reference but no longer part of the documented workflow.
- `generate-credentials.sh` — generated `FTP_LUXESPACE_PASS` for the
  legacy single-user `docker-compose` env vars. **Superseded by
  `add-tenant.sh`**; the env var is no longer read.
