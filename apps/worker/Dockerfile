# Build stage
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/worker/package.json ./apps/worker/

RUN npm install --workspace=apps/worker --workspace=packages/shared --include-workspace-root

COPY packages/shared ./packages/shared
COPY apps/worker ./apps/worker
COPY apps/api/prisma ./apps/api/prisma

# Build shared package first
WORKDIR /app/packages/shared
RUN npm run build

# Generate Prisma client and build worker
WORKDIR /app/apps/worker
RUN npx prisma generate --schema=../api/prisma/schema.prisma
RUN npm run build

# Production stage
FROM node:20-alpine AS production

RUN apk add --no-cache openssl

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=builder /app/apps/worker/package.json ./apps/worker/

WORKDIR /app/apps/worker

ENV NODE_ENV=production

CMD ["node", "dist/worker.js"]
