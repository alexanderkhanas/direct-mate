# Stage 1: Build. The admin is a plain SPA now (the landing moved to apps/web), so no prerender and no Chromium.
FROM node:22-bookworm-slim AS builder
WORKDIR /app

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
