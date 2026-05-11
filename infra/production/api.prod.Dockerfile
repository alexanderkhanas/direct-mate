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

# Glibc compatibility shim. `onnxruntime-node` (pulled in transitively by
# `@xenova/transformers` for CLIP image embeddings — see
# `image-embedding.service.ts`) ships prebuilt native binaries linked
# against glibc / ld-linux-x86-64.so.2. Alpine's musl libc lacks that
# loader, so any `require('onnxruntime-node')` throws ERR_DLOPEN_FAILED.
# The ImageEmbeddingService catches the error at module-init, but the
# dlopen failure also bubbles uncaught through the dynamic-import chain
# and kills the Node process (502 across the API). `libc6-compat`
# provides the missing loader + glibc symlinks so onnxruntime loads
# cleanly. Stays in the runtime stage only — keeps the builder lean.
RUN apk add --no-cache libc6-compat

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
# Demo seed reads source images from test-assets/. Ship the dir so
# `npm run seed:demo:prod` can copy them into uploads/ on first run.
COPY --from=builder /app/apps/api/test-assets ./apps/api/test-assets

ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "dist/main"]
