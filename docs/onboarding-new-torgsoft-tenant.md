# Onboarding a new tenant (Torgsoft → DirectMate)

End-to-end checklist for adding a new customer who syncs from
Torgsoft. Walk through in order. If you find a step missing or an
edge case that surprised you, add it for the next person.

**Total wall-clock time:** ~20 min on the operator side, then the
Torgsoft operator on the customer's PC has to configure their sync
object (~5 min for them).

**You'll need before starting:**

- The customer's chosen slug — lowercase `[a-z0-9-]+`, ≤32 chars
  (e.g. `luxespace`, `boutique-kyiv`).
- SSH access to the production VPS (`directmate_hetzner` key).
- Admin access to https://directmate.app/n8n/.
- Admin access to https://directmate.app (DirectMate UI) so you
  can create the tenant or look up its `tenant_id`.

---

## 1. Create the DirectMate tenant

Either the customer signs up themselves at
https://directmate.app/register, or you create them. Either way, by
the end of this step you must have:

- [ ] **`tenant_id`** (UUID) — the source of truth for everything
      downstream.
- [ ] **`slug`** in the DirectMate DB (auto-generated from the
      tenant name; may differ from the FTP slug — see note below).

Look up `tenant_id` by user email (run on production VPS):

```bash
ssh root@204.168.202.53 'docker exec production-postgres-1 \
  psql -U postgres -d directmate -c "
  SELECT u.email, t.id AS tenant_id, t.slug, t.name
  FROM users u JOIN tenants t ON t.id = u.tenant_id
  WHERE lower(u.email) = '\''customer@example.com'\'';"'
```

> ⚠️ **The DirectMate tenant slug and the FTP storage slug are
> independent.** Today's existing customer's DirectMate slug is
> `luxe-space` (auto-generated from "luxespace") but FTP storage is
> at `/srv/directmate-ftp/luxespace/`. **Pick the FTP slug
> deliberately** to match what you want in CDN URLs — it's part of
> the public CDN path and hard to change later. We recommend keeping
> it identical to the customer's brand name (no dash gymnastics).

---

## 1b. Create the Torgsoft connection row

The internal sync endpoint at `/api/internal/sync/catalog-import`
requires both a `tenantId` AND a `connectionId` that belongs to that
tenant (it verifies ownership). There's no admin UI for Torgsoft
connections yet, so insert directly via SQL:

```bash
ssh root@204.168.202.53 'docker exec production-postgres-1 \
  psql -U postgres -d directmate -c "
  INSERT INTO connections (tenant_id, type, status, metadata)
  VALUES (
    '\''<tenant_id>'\'',
    '\''torgsoft'\'',
    '\''connected'\'',
    jsonb_build_object(
      '\''ftp_login'\'',        '\''<slug>_trs'\'',
      '\''ftp_slug'\'',         '\''<slug>'\'',
      '\''sync_path'\'',        '\''/sync/TSGoods.trs'\'',
      '\''image_url_prefix'\'', '\''https://cdn.directmate.app/<slug>/images/'\''
    )
  )
  RETURNING id AS connection_id, tenant_id;"'
```

- [ ] Save the returned **`connection_id`** — you'll wire it into
      the n8n workflow in step 4.

> 💡 **Why `type='torgsoft'` when it's not in the `ConnectionType`
> enum?** The DB column is plain `TEXT` with no CHECK constraint.
> The enum in `packages/shared/src/enums.ts` is informational; the
> API only validates that the connectionId belongs to the tenantId.
> Adding `'torgsoft'` to the enum is a separate cleanup PR.

---

## 2. Provision FTP credentials

Run the multi-tenant onboarding script on the VPS as root:

```bash
ssh root@204.168.202.53
sudo /opt/directmate/scripts/ftp/add-tenant.sh <slug>
```

The script:

- Validates the slug (lowercase, `[a-z0-9-]+`, ≤32 chars).
- Refuses if the tenant already exists.
- Creates `/srv/directmate-ftp/<slug>/{sync,images}/` (mode 755,
  owner `ftp:ftp` = UID 14:80).
- Generates a 32-char hex password.
- Adds `<slug>_trs` to `/srv/directmate-ftp/.config/users.txt` and
  regenerates the Berkeley DB.
- Writes per-user vsftpd conf at
  `/srv/directmate-ftp/.config/user_conf.d/<slug>_trs`.
- Prints a credentials block.

**Save the credentials block in your password manager AND a secure
shared note immediately** — the password is not stored anywhere
recoverable. If you lose it, you have to `remove-tenant.sh` (which
archives storage) and re-add.

Verify from your laptop:

```bash
# Login + list root
curl -u "<slug>_trs:<password>" ftp://ftp.directmate.app/
# Expect: just sync/ and images/ — chrooted

# Upload to /images/
echo test > /tmp/test.jpg
curl -u "<slug>_trs:<password>" -T /tmp/test.jpg \
  ftp://ftp.directmate.app/images/test.jpg

# CDN serves it (public; lowercase-rename cron handles case after sync)
curl -I "https://cdn.directmate.app/<slug>/images/test.jpg"
# Expect: HTTP/2 200, content-type: image/jpeg
```

Cleanup the test file before handing the box to the customer:

```bash
ssh root@204.168.202.53 \
  'rm /srv/directmate-ftp/<slug>/images/test.jpg'
```

Reference: [scripts/ftp/README.md](../scripts/ftp/README.md)
("Adding a new tenant").

---

## 3. Hand the Torgsoft operator their config

The Torgsoft operator on the **customer's PC** sets up a sync object
("Об'єкт синхронізації" in Torgsoft UI). Send the credentials block
via a secure channel (password manager share, Signal — **not** plain
email/Telegram).

Field mapping:

| Torgsoft field | Value |
|---|---|
| Адреса (host) | `ftp.directmate.app` |
| Порт | `21` |
| Користувач (login) | `<slug>_trs` |
| Пароль | (generated) |
| Шлях до файлів синхро. | `/sync` |
| Шлях до зображень | `/images` |
| Режим передачі | `passive` |

Once configured, the operator triggers a sync. Watch for the upload
on the VPS:

```bash
ssh root@204.168.202.53 \
  'docker exec production-ftp-1 tail -f /var/log/vsftpd.log' \
  | grep "<slug>_trs"
```

You should see `OK LOGIN` followed by `OK UPLOAD` lines for each
file. Typical first sync: 1× `TSGoods.trs` (the CSV), then several
hundred to several thousand `<GoodID>.jpg` files. Wall time for the
customer's existing catalog: 2–20 minutes depending on size.

**If you don't see any traffic after the operator says "I clicked
sync":**
- They probably didn't enable image sync (separate Torgsoft
  checkbox from CSV sync).
- Or they typed the path with a typo. The `OK LOGIN` event would
  still fire but `OK UPLOAD` wouldn't.

After the upload settles, verify:

```bash
ssh root@204.168.202.53 'sudo /opt/directmate/scripts/ftp/list-tenants.sh'
```

You should see the new tenant with a non-zero size and a recent
`LAST_SYNC_MTIME`.

---

## 4. Create the n8n catalog-sync workflow

The CSV at `/srv/directmate-ftp/<slug>/sync/TSGoods.trs` doesn't
flow into DirectMate on its own — n8n parses + posts it to the
internal catalog-import endpoint.

There's a reference workflow already wired up for `luxespace`:
**"DirectMate / Torgsoft Sync — luxespace (inspect)"**. Easiest
path: clone it, swap two values.

1. Open https://directmate.app/n8n/
2. Find the luxespace workflow → "Duplicate"
3. Rename to "DirectMate / Torgsoft Sync — &lt;slug&gt;"
4. **In the FTP node**: change the credential to the new tenant's
   FTP credential (you'll create a new credential here using the
   block from step 2 above; n8n stores credentials separately per
   workflow).
5. **In the FTP node**: change the path from `/sync/TSGoods.trs` —
   only needed if your slug change affects this; usually `/sync/
   TSGoods.trs` is the same for every tenant since the FTP user is
   chrooted into their own tree.
6. **In the Code/normalize node**: add the new tenant's `tenant_id`
   (UUID from step 1) and `connection_id` to the output payload.
7. **In the HTTP Request node** (when you wire it up — current
   inspect workflow doesn't post yet; future PR): point at
   `https://directmate.app/api/internal/sync/catalog-import` with
   header `x-internal-key: $INTERNAL_API_KEY`.

> 💡 **Why each tenant gets its own workflow?** Until DirectMate has
> a multi-tenant connector registry on the platform side, the
> tenant_id and FTP credential are 1:1 with a workflow. Once we
> build that registry, this step collapses to "add a row in the
> connectors table".

Trigger the workflow once manually, watch the execution log:

- **FTP node** should show 1 binary item (the CSV).
- **Parse CSV node** should show ~880+ items.
- **Normalize node** should output ~880 normalized records each
  with the tenant_id stamped on it.

If anything fails, see the inspection notes in
[apps/api/CLAUDE.md](../apps/api/CLAUDE.md) and the n8n MCP tooling
documented in our session history.

---

## 5. End-to-end verification

Once the n8n workflow posts to DirectMate:

```sql
-- on production VPS, against the production DB
SELECT count(*) FROM products WHERE tenant_id = '<tenant_id>';
SELECT count(*) FROM product_variants WHERE tenant_id = '<tenant_id>';
SELECT count(*) FROM categories       WHERE tenant_id = '<tenant_id>';
```

Expected numbers depend on the customer's catalog. Spot-check:

```sql
-- A few random products with their categories and image URL
SELECT
  p.title,
  p.brand,
  p.gender,
  p.material,
  string_agg(c.name, ', ') AS categories
FROM products p
LEFT JOIN product_categories pc ON pc.product_id = p.id
LEFT JOIN categories c          ON c.id = pc.category_id
WHERE p.tenant_id = '<tenant_id>'
GROUP BY p.id
LIMIT 5;
```

Click through the corresponding image on the public CDN to confirm
it's reachable:

```
https://cdn.directmate.app/<slug>/images/<GoodID>.jpg
```

(The `GoodID` is the first column of `TSGoods.trs` and matches the
filename in `/images/`.)

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `530 Login incorrect` from Torgsoft | Wrong password OR `<slug>_trs` not in `users.txt` | `list-tenants.sh` shows DRIFT? Re-run `add-tenant.sh` after `remove-tenant.sh` |
| `FAIL UPLOAD` in vsftpd log, mode 600 files on disk | `LOCAL_UMASK=022` env var dropped from compose | Check `docker-compose.prod.yml` ftp service env; recreate container |
| CDN returns 200 for some files but 404 for others with uppercase extensions | Lowercase rename cron didn't run yet (`*/5` cadence) | Run it manually: `sudo /opt/directmate/scripts/ftp/lowercase-images.sh` |
| n8n FTP node times out | Hetzner firewall change closed PASV ports | Reopen TCP 21100-21110 in Hetzner cloud firewall |
| n8n posts but DirectMate returns 400 | Validation failure in DTO | Check the response body — `gender` not in enum, `salePrice > price`, etc. |

---

## Removing a tenant

```bash
sudo /opt/directmate/scripts/ftp/remove-tenant.sh <slug>
```

Drops FTP login, archives storage to
`/srv/directmate-ftp-archive/<slug>-YYYY-MM-DD/`, leaves a clean
slate. Storage is preserved (move, not delete) — manual
`rm -rf /srv/directmate-ftp-archive/...` to permanently delete after
you're sure nothing references it.

The DirectMate tenant row is **not** touched by this — soft-deleting
or hard-deleting the tenant in DirectMate is a separate operation
through the admin panel or DB, depending on whether you want to
preserve historical conversations.

---

## Out of scope (for now)

- **Self-service onboarding.** Currently every step requires
  operator action. A future change might allow the customer to add
  their own FTP credential through the admin UI; until then,
  manual.
- **Auto-detect Torgsoft sync arrival** and trigger ingestion. Today
  the operator triggers the n8n workflow manually for the first
  sync; subsequent runs are scheduled.
- **Per-tenant rate limiting / disk quotas.** Single shared FTP
  daemon. Add when it becomes a problem.
- **Retroactive image rename when slug changes.** Pick the slug
  carefully on day one.
