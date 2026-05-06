# CDN — public read-only image origin

`cdn.directmate.app` serves product images uploaded via FTP
(`/srv/directmate-ftp/{tenant}/images/`) over HTTPS to Instagram and
the DirectMate bot. Single-tenant for now (`luxespace`); new tenants
get a directory and that's it (no nginx config change required).

- Vhost: `cdn.directmate.app` (separate from `directmate.app`)
- Origin: nginx Alpine container (the existing reverse-proxy stack)
- TLS: Let's Encrypt, auto-renewed by the existing `certbot` service
- Multi-tenant ready: route `/{tenant}/images/{file}` is the canonical path

## URL pattern

```
https://cdn.directmate.app/{tenant}/images/{filename}
```

Example: the file at
`/srv/directmate-ftp/luxespace/images/178.jpg` (on the host) is
served at
`https://cdn.directmate.app/luxespace/images/178.jpg`.

Allowed extensions: `jpg`, `jpeg`, `png`, `webp`, `gif`
(case-insensitive routing — nginx serves the file whose name
matches what's on disk).

Anything outside that whitelist returns **404**:

- `/luxespace/sync/...` (sync files are private)
- `/luxespace/images/foo.exe` (wrong extension)
- `/luxespace/images/` (directory listing disabled)
- `/luxespace/images/.env` (dotfile)
- Root `/`, any other path

## Files in this PR

| File | Purpose |
|---|---|
| `infra/production/docker-compose.prod.yml` | Adds `/srv/directmate-ftp:/srv/directmate-ftp:ro` bind mount on the nginx container |
| `infra/production/nginx/conf.d/cdn.conf` | Vhost: HTTP→HTTPS redirect, ACME challenge, HTTPS image origin with cache + CORS + path whitelist |

The cert lives in the existing `certbot_etc` volume alongside the
apex `directmate.app` cert. Auto-renewal works because the
`certbot` service in `docker-compose.prod.yml` runs `certbot renew`
in a 12-hour loop; the cert is picked up automatically.

## DNS

Already done by operator (verified `204.168.202.53`):

```
cdn.directmate.app  A  204.168.202.53
```

If the IP ever moves, update both the apex and `cdn` A records.

## First-time deploy on a fresh VPS

The CI pipeline (`.github/workflows/deploy.yml`) handles steady-state
deploys, but the very first time the cert needs to exist before
nginx can load the HTTPS server block. Two-step sequence:

1. **Stage 1 — HTTP-only.** Push a temporary `cdn.conf` that has only
   the `:80` server block (with the `/.well-known/acme-challenge/`
   handler), and the volume mount on nginx. Recreate nginx:
   ```bash
   cd /opt/directmate/infra/production
   docker compose -f docker-compose.prod.yml up -d nginx
   docker exec production-nginx-1 nginx -t
   ```

2. **Issue cert** (uses the existing certbot account):
   ```bash
   docker compose -f docker-compose.prod.yml run --rm certbot \
     certonly --webroot \
     --webroot-path=/var/www/certbot \
     --keep-until-expiring \
     --non-interactive \
     --agree-tos --no-eff-email \
     -d cdn.directmate.app
   ```

3. **Stage 2 — full HTTPS.** Replace `cdn.conf` with the version
   that includes the `:443` server block (the one in the repo) and
   reload:
   ```bash
   docker exec production-nginx-1 nginx -t \
     && docker exec production-nginx-1 nginx -s reload
   ```

After that, the CI pipeline manages everything (rsync conf →
`docker compose up -d` → `nginx -s reload`) and `certbot renew`
keeps the cert fresh.

## Verification

Run from your local machine (so DNS, TLS, and firewall hops are
exercised end to end). All checks should pass; record results in
the table below if you re-deploy.

### a) HTTPS reachable
```bash
curl -I https://cdn.directmate.app/luxespace/images/178.jpg
```
Expect: `HTTP/2 200`, `content-type: image/jpeg`,
`cache-control: public, max-age=86400`, `etag: ...`,
`access-control-allow-origin: *`.

### b) Sync directory blocked
```bash
curl -I https://cdn.directmate.app/luxespace/sync/TSGoods.trs
```
Expect: `HTTP/2 404`. Sync files must NEVER be public.

### c) Directory listing disabled
```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  https://cdn.directmate.app/luxespace/images/
```
Expect: `404`. (Not a list of files.)

### d) Non-existent file
```bash
curl -I https://cdn.directmate.app/luxespace/images/nonexistent.jpg
```
Expect: `HTTP/2 404`.

### e) Wrong extension blocked
```bash
curl -I https://cdn.directmate.app/luxespace/images/test.exe
```
Expect: `HTTP/2 404`. The whitelist regex rejects the request
*before* nginx even checks the disk.

### f) HTTP redirects to HTTPS
```bash
curl -I http://cdn.directmate.app/luxespace/images/178.jpg
```
Expect: `HTTP/1.1 301 Moved Permanently`,
`Location: https://cdn.directmate.app/luxespace/images/178.jpg`.

### g) CORS header
```bash
curl -sIE https://cdn.directmate.app/luxespace/images/178.jpg \
  | grep -i access-control
```
Expect: `access-control-allow-origin: *`.

### h) Case-sensitivity (observation only — not a fix)

There are ~36 files on disk with uppercase extensions
(`*.JPG`, `*.JPEG`). The route regex matches case-insensitively,
so a request for `178.JPG` is accepted by the route — but
`try_files` only matches the exact on-disk casing. Result:
- `cdn.directmate.app/luxespace/images/178.jpg` → 200 (file is `178.jpg` on disk)
- `cdn.directmate.app/luxespace/images/178.JPG` → 200 *only if* the file is `178.JPG` on disk
- The bot cannot blindly assume `.jpg` is correct casing — it must use the exact filename Torgsoft sent.

The CSV's `GoodID`-derived URL builder must preserve the exact
filename casing as listed in the FTP directory. A separate PR
will lowercase-rename the on-disk files for consistency; until
then, query the directory for the actual filename.

## Adding a new tenant

Zero nginx config changes needed. The vhost regex
`^/[^/]+/images/...` accepts any tenant slug.

```bash
# On the VPS:
sudo mkdir -p /srv/directmate-ftp/{newtenant}/{images,sync}
sudo chown -R 14:80 /srv/directmate-ftp/{newtenant}
sudo chmod 755 /srv/directmate-ftp/{newtenant} \
                /srv/directmate-ftp/{newtenant}/images \
                /srv/directmate-ftp/{newtenant}/sync
```

Then the new tenant's images at
`/srv/directmate-ftp/{newtenant}/images/foo.jpg` are immediately
reachable at
`https://cdn.directmate.app/{newtenant}/images/foo.jpg`.

(The *FTP user* for the new tenant is a separate concern — see
`scripts/ftp/README.md`. CDN is read-only and tenant-agnostic.)

## Troubleshooting

- **`nginx -t` fails after pulling new conf**: the cert hasn't been
  issued yet. Roll back to the HTTP-only stub or run the cert
  issuance command above.
- **404 for a file that exists on disk**: check filename casing.
  `ls -la /srv/directmate-ftp/luxespace/images/ | grep -i <basename>`
  shows what's actually there. Nginx serves the exact name on disk.
- **Cert won't renew**: `docker compose run --rm certbot certificates`
  shows expiry; manually trigger with
  `docker compose run --rm certbot renew`. If renewal fails because
  port 80 is unreachable, check the `/.well-known/acme-challenge/`
  location in `cdn.conf` and that nginx is up.
- **Logs**: per-vhost access log inside the nginx container at
  `/var/log/nginx/cdn.directmate.app.access.log`. Tail with
  `docker exec production-nginx-1 tail -f /var/log/nginx/cdn.directmate.app.access.log`.

## Out of scope (deferred)

- Image transforms (resize, webp conversion, watermark)
- Signed URLs / authentication (CDN is intentionally public for v1)
- Rate limiting (add if abuse appears)
- Edge CDN in front (Cloudflare etc.) — origin-only for v1
- Lowercase-rename script (separate PR)
- Content-hash deduplication (Torgsoft uploads ~68% byte-duplicate
  images across variants — separate concern)
