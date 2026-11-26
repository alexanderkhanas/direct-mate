# The marketing site (apps/web): static pages built by Astro, served by nginx.
# Stage 1: Build. Astro 7 refuses Node below 22.23.4, so this stage uses Node 24.
# apps/web is its own package with its own lockfile (not an npm workspace): only its files are copied, never a
# local node_modules or dist.
FROM node:24-bookworm-slim AS builder
WORKDIR /app

COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

COPY apps/web/astro.config.mjs apps/web/tailwind.config.js apps/web/postcss.config.js apps/web/tsconfig.json ./
COPY apps/web/public public
COPY apps/web/src src

# Sign-up and sign-in links on every page (src/site.ts).
ENV PUBLIC_PLATFORM_URL=https://platform.directmate.app
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY infra/production/nginx/web.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
