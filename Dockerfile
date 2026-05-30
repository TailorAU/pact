FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ── Install dependencies ─────────────────────────────────
# Install the FULL dependency graph (incl. devDependencies). `next build`
# needs build-time-only packages such as `@tailwindcss/postcss` and
# `tailwindcss` to compile `globals.css` — Next 16.2's Turbopack PostCSS
# transform hard-`require()`s them, so an `--omit=dev` install fails the
# build with "Cannot find module '@tailwindcss/postcss'". This costs the
# runtime image nothing: `output: "standalone"` (next.config.ts) means the
# runner stage copies only `.next/standalone` — these node_modules are not
# carried into the final image.
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci 2>/dev/null || npm install

# ── Build ─────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=""
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

RUN npm run build

# ── Runtime ───────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# sql/ dir required at runtime: initSchema() reads legislation-schema.sql via fs.readFileSync (WS8)
COPY --from=builder --chown=nextjs:nodejs /app/sql ./sql

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
