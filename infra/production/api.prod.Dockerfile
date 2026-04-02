# Stage 1: Build
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json .npmrc ./
COPY packages/shared/package*.json packages/shared/
COPY apps/api/package*.json apps/api/

RUN npm ci --legacy-peer-deps

# Build shared package first
COPY packages/shared packages/shared
RUN cd packages/shared && npm run build

# Build API
COPY apps/api apps/api
RUN cd apps/api && npm run build

# Stage 2: Production
FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/

ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "dist/main"]
