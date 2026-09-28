# syntax=docker/dockerfile:1.7
#
# Frontend (apps/web). Build from the REPO ROOT (it needs to see the whole npm workspace), not
# from apps/web/:
#
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_SUPABASE_URL=... \
#     --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
#     --build-arg NEXT_PUBLIC_ACCOUNT_SERVICE_URL=https://your-account-service \
#     --build-arg NEXT_PUBLIC_POST_SERVICE_URL=https://your-post-service \
#     --build-arg NEXT_PUBLIC_SCHEDULING_SERVICE_URL=https://your-scheduling-service \
#     --build-arg NEXT_PUBLIC_MEDIA_SERVICE_URL=https://your-media-service \
#     --build-arg NEXT_PUBLIC_TEAM_SERVICE_URL=https://your-team-service \
#     --build-arg NEXT_PUBLIC_ANALYTICS_SERVICE_URL=https://your-analytics-service \
#     -t socialpush-web .
#
# All the NEXT_PUBLIC_* values are REQUIRED at build time, not run time: Next.js bakes them into
# the client-side JS bundle when it builds, so they must already be the real deployed backend
# URLs (see apps/web/src/lib/apiUrls.ts) - changing them later means rebuilding the image, not
# just restarting the container. Never put non-public secrets in a NEXT_PUBLIC_* var; anything
# with that prefix ships to every visitor's browser.

FROM node:20-bookworm-slim AS build
WORKDIR /app

# Whole repo, not just apps/web/: this is an npm workspace, so `npm install` resolves every
# workspace together. No package-lock.json is committed (see .gitignore - a Windows-generated one
# broke a previous Vercel build), so this is `npm install`, not `npm ci`.
COPY . .
RUN npm install

ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_ACCOUNT_SERVICE_URL
ARG NEXT_PUBLIC_POST_SERVICE_URL
ARG NEXT_PUBLIC_SCHEDULING_SERVICE_URL
ARG NEXT_PUBLIC_MEDIA_SERVICE_URL
ARG NEXT_PUBLIC_TEAM_SERVICE_URL
ARG NEXT_PUBLIC_ANALYTICS_SERVICE_URL
ENV NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL} \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY} \
    NEXT_PUBLIC_ACCOUNT_SERVICE_URL=${NEXT_PUBLIC_ACCOUNT_SERVICE_URL} \
    NEXT_PUBLIC_POST_SERVICE_URL=${NEXT_PUBLIC_POST_SERVICE_URL} \
    NEXT_PUBLIC_SCHEDULING_SERVICE_URL=${NEXT_PUBLIC_SCHEDULING_SERVICE_URL} \
    NEXT_PUBLIC_MEDIA_SERVICE_URL=${NEXT_PUBLIC_MEDIA_SERVICE_URL} \
    NEXT_PUBLIC_TEAM_SERVICE_URL=${NEXT_PUBLIC_TEAM_SERVICE_URL} \
    NEXT_PUBLIC_ANALYTICS_SERVICE_URL=${NEXT_PUBLIC_ANALYTICS_SERVICE_URL}

RUN npm run build -w web

# --- runtime: only the traced standalone output, not the full node_modules/build tree ---
FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000

# `output: 'standalone'` (next.config.ts) traces the app from the monorepo root, so the server
# entry point and its traced node_modules land under apps/web/ inside the standalone folder, not
# at its own root - the paths below mirror that. public/ and .next/static/ are never included in
# the standalone trace and must be copied in separately (Next.js's own documented pattern).
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
