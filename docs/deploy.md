# Deployment

Production deploys run via [.github/workflows/deploy.yml](../.github/workflows/deploy.yml).

The workflow has two paths:

- **Push to `main`** (automatic) — `build` → `deploy`. Ships code, runs migrations, restarts services, reloads nginx. Does NOT touch demo tenants.
- **`workflow_dispatch`** (manual, "Run workflow" button in the Actions tab) — same as above, then runs `seed-demo`. Use only when you need to (re)create the demo tenants.

## What `push to main` covers

Every push to `main` runs the `build` and `deploy` jobs. Concretely:

1. Builds `packages/shared`, `apps/api`, `apps/admin` on the runner.
2. rsyncs the repo to the prod box at `/opt/directmate/` (excludes `.git`, `node_modules`, `dist/`, `.env`, `conversations.log`, `apps/api/uploads/`).
3. Renders `nginx/conf.d/default.conf` from the template.
4. `docker compose -f infra/production/docker-compose.prod.yml build` on the server.
5. **Migrations**: `docker compose run --rm api node -e "AppDataSource.runMigrations()"`. Idempotent — runs only pending migrations.
6. `docker compose up -d --remove-orphans` — restarts containers whose images changed.
7. `nginx -s reload` for nginx config changes.

This is sufficient for **all pure-code changes** (engine fixes, classifier prompt changes, frontend updates, new templates that production tenants will edit through the admin panel).

## When to manually trigger `seed-demo`

The `seed-demo` job is gated on `workflow_dispatch`. Trigger it via **GitHub Actions tab → "Deploy to Production" workflow → "Run workflow"** when:

- **First time the multi-tenant demo refactor lands on `main`.** Without this run, prod has no `demo-women-clothes` or `demo-cosmetics` tenants, and the landing-page widget returns 503 from `/demo/message`.
- You change anything under `apps/api/src/scripts/seed/` (templates, products, builders, vertical data) and want production to reflect it.
- You add a new demo vertical (see [onboarding-new-business-type.md](onboarding-new-business-type.md)).

Do NOT trigger it for unrelated commits. Each run hard-deletes existing demo tenants (CASCADE through 25 FKs) and rebuilds — wasteful work on every push, and clobbers any in-flight demo conversations.

### What `seed-demo` does

1. SSHes to the prod box.
2. `docker compose run --rm api npm run seed:demo:prod:all` — runs:
   - `node dist/scripts/seed-demo-women-clothes.js` — deletes `slug='demo'` (legacy) and `slug='demo-women-clothes'`, asserts no orphans, rebuilds via `clothing-builder`.
   - `node dist/scripts/seed-demo-cosmetics.js` — deletes `slug='demo-cosmetics'`, asserts no orphans, rebuilds via `cosmetics-builder`.
   - Both seeds copy product images from `apps/api/test-assets/{,cosmetics/}` to `apps/api/uploads/{,cosmetics/}` via `fs.copyFileSync`.
3. `docker compose restart api` — `DemoService.onModuleInit` reads `is_demo=true` tenants once at boot, so the api MUST be restarted after the seed for the controller to find the new tenants.
4. Prints verification SQL output to the action log.

### Verifying the seed run

The last step of `seed-demo` runs:

```sql
SELECT slug, is_demo, flow_config -> 'businessType' AS bt,
       flow_config -> 'preQualifyStrategy' AS strat
FROM tenants t JOIN store_configs sc ON sc.tenant_id=t.id
WHERE t.slug LIKE 'demo%' ORDER BY t.slug;
```

Expected output in the action log:

```
slug                | is_demo | bt          | strat
--------------------+---------+-------------+----------------------
demo-cosmetics      | t       | "cosmetics" | "before_search"
demo-women-clothes  | t       | "clothing"  | "after_search_offered"
```

Legacy `slug='demo'` row should be gone.

## Deploy sequence: shipping the multi-tenant demo refactor

This is the load-bearing first deploy. Order matters.

1. **Commit and push** the 7-phase changes to `main` (or merge the PR).
2. Wait for the `build` + `deploy` jobs to finish. Migrations `1735` (preQualifyStrategy default) and `1736` (businessType field) run automatically. The 6 existing non-demo tenants get `flow_config.businessType='clothing'`.
3. **Manually trigger `seed-demo`** via the Actions tab. This deletes the legacy `demo` tenant, rebuilds `demo-women-clothes` + `demo-cosmetics`, and restarts the api.
4. Verify in the browser: `https://<DOMAIN>/` → demo widget → switch tabs (Жіночий одяг ↔ Косметика) → run a scripted scenario in each → switch to live mode and send a message in each.

Subsequent deploys: just push. Migrations stay idempotent. Demo tenants stay alive.

## Pipeline-bypassed paths

The pipeline excludes a few things from rsync (line 50-60 of `deploy.yml`):

- `apps/api/uploads/` — user-generated state, not deployable. Created on first seed run.
- `apps/api/.env` and `infra/production/.env` — secrets, managed manually on the server.
- `apps/api/conversations.log` — runtime log file.
- `apps/api/dist/` and `apps/admin/dist/` — built ON the server in step 4.
- `node_modules`, `.git` — obvious.

`apps/api/test-assets/` is NOT excluded — it ships with every deploy. The seed reads from there.

## Failure modes

### Migrations fail

The `Run migrations` step runs `runMigrations()` inline. If a migration throws, the job exits non-zero. Common causes:

- Connection refused: the api container can't reach postgres. Check `docker compose ps` on the server.
- Migration already partially applied: rare, since TypeORM tracks `migrations` table. If it happens, inspect the table and resolve manually.

The deploy job stops at this step if migrations fail — no restart, no nginx reload. Roll back the migration manually before retrying.

### Seed step fails on `assertNoOrphans`

After `deleteTenantBySlug`, the seed runs `SELECT slug FROM tenants WHERE slug = ANY(...)` — if any row survived the delete, it aborts. Causes:

- Another process held a long-running transaction. Retry after a minute.
- A FK constraint missing CASCADE (shouldn't happen — Phase 0 confirmed all 25 FKs cascade).
- DB permissions denied DELETE.

Don't retry blindly. SSH in, inspect the tenant row, figure out which dependent table held it, then re-trigger the workflow.

### `/demo/message` returns 503 after seed

Means `DemoService` cache is stale. The seed-demo job already restarts the api in step 3 — but if you ran the seed manually (not via the workflow), you need to restart yourself:

```bash
ssh root@<SERVER_HOST> 'cd /opt/directmate/infra/production && docker compose -f docker-compose.prod.yml restart api'
```

### Images broken in widget

The seed's `fs.copyFileSync` requires the right working directory inside the container. Check that `apps/api/test-assets/cosmetics/` shipped:

```bash
ssh root@<SERVER_HOST> 'ls /opt/directmate/apps/api/test-assets/cosmetics/ | wc -l'
# expect: 13
```

If empty, the rsync skipped them — check the workflow's exclude list didn't grow.

Then check the seed actually wrote to uploads:

```bash
ssh root@<SERVER_HOST> 'docker exec production-api-1 ls /app/apps/api/uploads/cosmetics/ | head'
# expect: 13 files
```

If empty after a seed run, the seed ran from a wrong cwd inside the container. The api container's WORKDIR should be `/app/apps/api`.

### Postgres container name mismatch in verify step

The verification SQL in `seed-demo` runs `docker exec production-postgres-1 psql ...`. Docker Compose names containers as `<project>-<service>-<index>`. Project name is taken from the directory (`infra/production/`) by default. If `COMPOSE_PROJECT_NAME` is overridden somewhere, the container name changes.

The seed itself still ran successfully — only the verification step fails. To fix permanently, replace the hardcoded name in the verify step with:

```bash
docker exec $(docker compose -f docker-compose.prod.yml ps -q postgres) psql ...
```

## Local equivalents

For development, the same scripts run via `ts-node`:

```bash
# Start postgres
cd infra/docker && docker compose up -d

# Run migrations
cd apps/api && npx ts-node -r tsconfig-paths/register ../../node_modules/typeorm/cli.js migration:run -d src/database/data-source.ts

# Seed demo tenants
cd apps/api && npm run seed:demo:all

# Start backend / frontend
cd apps/api && npm run dev    # in one terminal
cd apps/admin && npm run dev  # in another
```

## Roll-back posture

The pipeline has no automated rollback. To roll back code, push a revert commit; pipeline reships. To roll back a migration, write and ship a new migration that undoes it (don't manually `DROP COLUMN` against prod). To roll back the demo tenants — just trigger `seed-demo` again with whatever templates/products you want.

The demo tenants are non-load-bearing for production customers (`is_demo=true` filter excludes them from analytics, order creation, etc.), so a corrupted demo state never blocks real traffic.
