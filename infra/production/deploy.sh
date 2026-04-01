#!/bin/bash
# Deploy DirectMate production stack
# Usage: ./deploy.sh [--init-ssl email@example.com]

set -e
cd "$(dirname "$0")"

# Load env
if [ ! -f .env ]; then
  echo "ERROR: .env file not found. Copy .env.example to .env and fill in values."
  exit 1
fi
source .env

COMPOSE="docker compose -f docker-compose.prod.yml"

# Replace domain placeholder in nginx config
sed "s/\${DOMAIN}/$DOMAIN/g" nginx/conf.d/default.conf > nginx/conf.d/default.active.conf

echo "==> Building images..."
$COMPOSE build

echo "==> Starting database..."
$COMPOSE up -d postgres
sleep 3

echo "==> Running migrations..."
$COMPOSE run --rm api sh -c "cd /app/apps/api && node -e \"
const { AppDataSource } = require('./dist/database/data-source');
AppDataSource.initialize().then(ds => ds.runMigrations()).then(() => {
  console.log('Migrations complete');
  process.exit(0);
}).catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
\""

# SSL initialization (first deploy only)
if [ "$1" = "--init-ssl" ] && [ -n "$2" ]; then
  echo "==> Starting nginx for ACME challenge..."
  $COMPOSE up -d nginx
  sleep 2

  echo "==> Requesting SSL certificate..."
  $COMPOSE run --rm certbot certonly --webroot \
    --webroot-path=/var/www/certbot \
    --email "$2" \
    --agree-tos \
    --no-eff-email \
    -d "$DOMAIN"

  echo "==> Certificate obtained!"
fi

echo "==> Starting all services..."
$COMPOSE up -d

echo ""
echo "==> Deployment complete!"
echo "    Admin:    https://$DOMAIN"
echo "    API docs: https://$DOMAIN/docs"
echo "    n8n:      https://$DOMAIN/n8n/"
echo ""
echo "    View logs: $COMPOSE logs -f"
