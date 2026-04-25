# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

# Build-time env vars consumed by Vite. Must be ARG (not ENV-only) because
# Vite inlines `import.meta.env.VITE_*` at build time. Defaults are empty so
# the bundle gracefully no-ops PostHog if the build happens without these.
ARG VITE_POSTHOG_KEY=
ARG VITE_POSTHOG_HOST=https://eu.i.posthog.com
ENV VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY
ENV VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST

COPY package*.json .npmrc ./
COPY packages/shared/package*.json packages/shared/
COPY apps/admin/package*.json apps/admin/

RUN npm ci --legacy-peer-deps
RUN npm install react-is --legacy-peer-deps

COPY packages/shared packages/shared
RUN cd packages/shared && npm run build

COPY apps/admin apps/admin
RUN cd apps/admin && npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine
COPY --from=builder /app/apps/admin/dist /usr/share/nginx/html
COPY infra/production/nginx/admin.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
