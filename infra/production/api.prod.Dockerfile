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
# Debian slim (NOT Alpine). `onnxruntime-node` (pulled in transitively by
# `@xenova/transformers` for CLIP image embeddings — see
# `image-embedding.service.ts`) ships prebuilt native binaries linked
# against glibc. Alpine's musl + libc6-compat shim resolves the dlopen
# but onnxruntime's internal C++ threads still SIGABRT with `Ort::Exception`
# at startup, crashing the API. node:20-slim is Debian-based with real
# glibc — onnxruntime loads and runs cleanly. Image is ~140MB larger
# than Alpine but production stability > image size.
FROM node:20-slim
WORKDIR /app

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
