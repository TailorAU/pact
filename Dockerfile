FROM node:22-alpine AS base
# #5644 / #5751 — upgrade the base image's apk packages at build time. The
# `node:22-alpine` tag lags the alpine 3.24 security repo (e.g. openssl
# libcrypto3/libssl3 3.5.7-r0 with CVE-2026-14456 while 3.5.8-r0 is already
# published), and every stage (deps, builder, runner) derives from this one,
# so the runtime layer inherits the patched packages. Weekly `source-cve-scan`
# re-measures the pushed image; a finding with a `Fixed Version` in the repo
# is closed by this line, not by an allowlist entry.
RUN apk upgrade --no-cache && apk add --no-cache libc6-compat
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

# Strip the base image's bundled npm/npx from the RUNTIME layer.
#
# `output: "standalone"` means this stage runs `node server.js` directly —
# npm is never invoked at runtime (no `npm start`, no lifecycle scripts, no
# runtime installs). But `node:22-alpine` bundles npm, and npm vendors its
# own dependency tree, so Trivy attributes those CVEs to the shipped image.
#
# CVE-2026-59873 (CRITICAL, node-tar gzip-bomb DoS, tar 7.5.11 -> 7.5.19)
# arrives purely that way: `tar` is NOT an application dependency — it does
# not appear in package.json or package-lock.json at any depth. It reached
# production only as an unreachable file inside bundled npm. It has failed
# the cd-source.yml CRITICAL gate on every run since 2026-07-13, blocking
# ALL source-kg deploys (refs #4525).
#
# Deleting the package managers removes the vulnerable code from the
# artefact rather than suppressing the finding, so the gate stays honest: a
# future CRITICAL in code we actually ship still fails the build. The
# builder stage keeps npm (it runs `npm ci` + `npm run build`); only the
# runtime layer is stripped. yarn goes too — it is equally unused here and
# vendors its own tree.
#
# The `command -v` assertions make this SELF-VERIFYING: if a future base
# image relocates these binaries, the build fails loudly instead of
# silently shipping them again. Do not soften them to `|| true`.
RUN rm -rf /usr/local/lib/node_modules/npm \
           /usr/local/bin/npm \
           /usr/local/bin/npx \
           /usr/local/bin/yarn \
           /usr/local/bin/yarnpkg \
           /opt/yarn-* \
 && if command -v npm >/dev/null 2>&1; then echo "npm still present after strip" >&2; exit 1; fi \
 && if command -v npx >/dev/null 2>&1; then echo "npx still present after strip" >&2; exit 1; fi \
 && if command -v yarn >/dev/null 2>&1; then echo "yarn still present after strip" >&2; exit 1; fi \
 && node --version

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
