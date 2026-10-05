# syntax=docker/dockerfile:1.7
#
# Builds ONE backend service from this npm-workspaces monorepo (apps/web has its own Dockerfile
# at apps/web/Dockerfile - Next.js needs a different build). Pick the service with --build-arg:
#
#   docker build --build-arg SERVICE=account-service -t socialpush-account-service .
#
# SERVICE must be a directory name under services/: account-service, post-service,
# publishing-service, scheduling-service, worker, media-service, notification-service,
# analytics-service, team-service.
#
# worker and notification-service don't listen on a port (they only process BullMQ queues) -
# EXPOSE is harmless either way and left out; nothing else about the build differs.
#
# Node 22, not 20: with no lockfile, `npm install` pulls the latest @supabase/supabase-js, whose
# realtime client needs Node's native global WebSocket (Node 22+) and throws at createClient() on 20.

FROM node:22-bookworm-slim AS build
WORKDIR /app

# The whole repo is copied in (not just this service's package.json) because this is an npm
# workspace: `npm install` resolves and hoists every workspace's dependencies together, and
# service code imports the local @socialpush/shared and @socialpush/ai packages by name, which
# only resolve correctly once the workspace has been installed as a whole. No package-lock.json
# is committed (see .gitignore - a Windows-generated one broke a previous Vercel build by
# resolving Windows-only optional deps), so this is `npm install`, not `npm ci`.
# --legacy-peer-deps: the base image's bundled npm (10.8.2) has a known Arborist crash
# ("Cannot read properties of null (reading 'edgesOut')") when resolving certain peer-dependency
# conflicts (e.g. a library whose peerDependencies still pin React 18 under React 19) - this
# doesn't reproduce with newer npm (11.x), which is what local dev machines run.
COPY . .
RUN npm install --legacy-peer-deps

# Every service's package.json depends on @socialpush/shared; some also use @socialpush/ai
# (post-service, analytics-service). Both must be compiled to dist/ before `tsc` in the target
# service can resolve their types - same order the README's manual build steps use.
RUN npm run build -w @socialpush/shared
RUN npm run build -w @socialpush/ai

ARG SERVICE
RUN test -n "$SERVICE" || (echo "Missing --build-arg SERVICE=<name>, e.g. account-service" && exit 1)
RUN npm run build -w @socialpush/${SERVICE}

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ARG SERVICE
ENV SERVICE=${SERVICE}

# The full built workspace, not just one service's dist/: npm's hoisted node_modules and the
# workspace symlinks under node_modules/@socialpush/* only work together as the whole tree.
COPY --from=build /app /app

WORKDIR /app/services/${SERVICE}
CMD ["node", "dist/index.js"]
