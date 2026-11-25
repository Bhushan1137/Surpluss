# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/

RUN npm install --workspace=apps/web --workspace=packages/shared --include-workspace-root

COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

WORKDIR /app/packages/shared
RUN npm run build

WORKDIR /app/apps/web

ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3001

CMD ["node", "apps/web/server.js"]
