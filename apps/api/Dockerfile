# Build stage
FROM node:20-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

# Copy workspace manifests
COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

# Install all workspace deps
RUN npm install --workspace=apps/api --workspace=packages/shared --include-workspace-root

# Copy source
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Build shared package first
WORKDIR /app/packages/shared
RUN npm run build

# Generate Prisma client and build NestJS app
WORKDIR /app/apps/api
RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:20-alpine AS production

RUN apk add --no-cache openssl

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --from=builder /app/apps/api/package.json ./apps/api/

WORKDIR /app/apps/api

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/main"]
