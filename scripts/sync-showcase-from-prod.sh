#!/bin/bash
# Sync the showcase-women-clothes tenant from prod into the local DB.
#
# Replaces local catalog, media mappings, templates, configs, and tenant
# row with the prod copies. The point is so simulator scenarios that
# rely on real linked stories run identically in both envs.
#
# NOT copied (intentional):
#   - users        (no showcase users locally; prod auth wouldn't work anyway)
#   - connections  (encrypted with prod ENCRYPTION_KEY)
#   - conversations / messages / customers / orders / audit_logs (PII + churn)
#   - subscription_usage, sync_jobs, integration_events, etc. (state)
#
# CASCADE drop removes any local conversation/message rows under the
# showcase tenant. Re-run safely.

set -euo pipefail

PROD_HOST="root@204.168.202.53"
PROD_PG_CONTAINER="production-postgres-1"
LOCAL_PG_CONTAINER="docker-postgres-1"
SSH_KEY="$HOME/.ssh/directmate_hetzner"
SLUG="showcase-women-clothes"

prod_psql() {
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$PROD_HOST" \
    "docker exec -i $PROD_PG_CONTAINER psql -U postgres -d directmate $*"
}

local_psql() {
  docker exec -i "$LOCAL_PG_CONTAINER" psql -U postgres -d directmate "$@"
}

# Resolve prod tenant id
TENANT_ID=$(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$PROD_HOST" \
  "docker exec $PROD_PG_CONTAINER psql -U postgres -d directmate -At -c \"SELECT id FROM tenants WHERE slug = '$SLUG'\"")

if [ -z "$TENANT_ID" ]; then
  echo "ERROR: tenant slug='$SLUG' not found in prod"
  exit 1
fi
echo "Prod tenant_id: $TENANT_ID"

# Drop local showcase tenant (CASCADE drops all child rows).
echo "Dropping local '$SLUG' tenant + cascade..."
local_psql -c "DELETE FROM tenants WHERE slug = '$SLUG';" > /dev/null

# Each call streams one table's filtered rows via COPY ... TO STDOUT on
# prod → COPY ... FROM STDIN on local. Order matters for FK constraints.
copy_filtered() {
  local table=$1
  local where=$2
  local count
  count=$(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$PROD_HOST" \
    "docker exec $PROD_PG_CONTAINER psql -U postgres -d directmate -At -c \"SELECT COUNT(*) FROM $table WHERE $where\"")
  printf "  %-30s %5s rows ... " "$table" "$count"
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=no "$PROD_HOST" \
    "docker exec $PROD_PG_CONTAINER psql -U postgres -d directmate -c \"COPY (SELECT * FROM $table WHERE $where) TO STDOUT;\"" \
    | local_psql -c "COPY $table FROM STDIN;" > /dev/null
  echo "ok"
}

BY_TENANT="tenant_id = '$TENANT_ID'"
BY_PRODUCT="product_id IN (SELECT id FROM products WHERE tenant_id = '$TENANT_ID')"
BY_VARIANT="variant_id IN (SELECT id FROM product_variants WHERE tenant_id = '$TENANT_ID')"

echo "Copying from prod → local..."
copy_filtered tenants                  "id = '$TENANT_ID'"
copy_filtered tenant_settings          "$BY_TENANT"
copy_filtered store_configs            "$BY_TENANT"
copy_filtered response_templates       "$BY_TENANT"
copy_filtered phrase_blocks            "$BY_TENANT"
copy_filtered faq_items                "$BY_TENANT"
copy_filtered categories               "$BY_TENANT"
copy_filtered products                 "$BY_TENANT"
copy_filtered product_variants         "$BY_TENANT"
copy_filtered stock_balances           "$BY_VARIANT"
copy_filtered product_media            "$BY_PRODUCT"
copy_filtered product_categories       "$BY_PRODUCT"
copy_filtered size_charts              "$BY_TENANT"
copy_filtered instagram_media_mappings "$BY_TENANT"

echo
echo "Local showcase tenant now mirrors prod (catalog, templates, links)."
echo "  - Re-link a local Instagram account in admin if you want to test live."
echo "  - Image URLs that point at prod /uploads/ paths won't resolve locally."

# Create a local admin user for the synced tenant. Local-only credentials
# — prod password hashes are not copied and would not validate anyway
# (different JWT_SECRET, different user table). Override via env vars.
ADMIN_EMAIL="${SHOWCASE_ADMIN_EMAIL:-showcase@directmate.local}"
ADMIN_PASSWORD="${SHOWCASE_ADMIN_PASSWORD:-showcase1234}"

echo
echo "Creating local admin user..."
PASSWORD_HASH=$(cd "$(dirname "$0")/../apps/api" && node -e "console.log(require('bcrypt').hashSync('$ADMIN_PASSWORD', 10))")

local_psql -c "INSERT INTO users (tenant_id, email, password_hash, role, is_active) VALUES ('$TENANT_ID', '$ADMIN_EMAIL', '$PASSWORD_HASH', 'owner', true) ON CONFLICT (tenant_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash;" > /dev/null

echo "  email:    $ADMIN_EMAIL"
echo "  password: $ADMIN_PASSWORD"
