# Stage 1: Build (Debian-based — react-snap's puppeteer Chromium needs glibc)
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# Chromium for react-snap's prerender pass. Point puppeteer at the apt
# binary instead of letting it download its own — smaller image, glibc-clean.
RUN apt-get update \
    && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

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
