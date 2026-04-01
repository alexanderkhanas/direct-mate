#!/bin/bash
# Usage: ./init-letsencrypt.sh yourdomain.com your@email.com

set -e

DOMAIN=$1
EMAIL=$2

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "Usage: ./init-letsencrypt.sh <domain> <email>"
  exit 1
fi

echo "==> Requesting Let's Encrypt certificate for $DOMAIN..."

# Replace ${DOMAIN} placeholder in nginx config
sed -i "s/\${DOMAIN}/$DOMAIN/g" /etc/nginx/conf.d/default.conf 2>/dev/null || true

# Start nginx with self-signed cert first (for ACME challenge)
docker compose -f docker-compose.prod.yml run --rm certbot \
  certonly --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

echo "==> Certificate obtained! Restarting nginx..."
docker compose -f docker-compose.prod.yml restart nginx

echo "==> Done! SSL is active for $DOMAIN"
