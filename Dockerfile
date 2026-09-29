FROM node:20-bookworm-slim AS deps
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY vendor/xlsx-0.20.3.tgz ./vendor/xlsx-0.20.3.tgz
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATABASE_URL=postgresql://crm:password@localhost:5432/crm?schema=public

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run prisma:generate:prod
RUN npm run build

EXPOSE 3000
CMD ["npm", "run", "start"]
