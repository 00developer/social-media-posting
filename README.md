# SocialPush 🚀

SocialPush is a multi-platform social media scheduling and publishing tool ("write once, publish everywhere"). A user (or team) connects social accounts via OAuth, composes a post with an optional image/video, picks target platforms, and either publishes immediately or schedules it for later. A background worker publishes through per-platform adapters and notifies the user of the result; analytics are pulled back periodically.

This README describes the **actual current state** of the project (verified by reading the code and, in several places, by testing against the real database), not an aspirational feature list.

## ⚠️ Before you deploy this or share a live link

This project is not yet in a state where a stranger can open a deployed link and fully use it end-to-end. Specifically:

1. **OAuth apps are in test/development mode.** The Facebook/Instagram/Threads app (Meta) and the Google Cloud project (YouTube) are not yet through their respective app review / verification processes. Until that's done, **only accounts explicitly added as test users in those consoles can connect** — a real outside user trying to connect their own Facebook, Instagram, YouTube or Threads account will hit an "access blocked" / "can't load URL" style error. This is a third-party platform restriction, not a bug in this code.
2. **Two integrations are not real:** LinkedIn's OAuth callback stores a mock token (nothing published actually reaches LinkedIn), and TikTok is fully stubbed (connect and publish are both simulated). Both currently still appear as normal "Connected" platforms in the UI.
3. **CORS is still wide open (`*`) on every backend service.** Session-verified endpoints (see below) reject a request whose token doesn't match the claimed user/team, but any origin can still reach these services — there's no origin allowlist yet.

None of this blocks pushing the code or deploying it for a first look — it does mean "let anyone fully test it live" needs the fixes above first.

### What was fixed since the last note
A full-codebase security/business-logic audit (see git history around commit `056829c`) fixed the two biggest blockers that used to be listed here:
- **Backend session verification added.** `account-service`, `team-service`, `post-service`, `scheduling-service` and `media-service` now verify the caller's Supabase JWT server-side (`requireUser`/`requireTeamMember` in `packages/shared/src/auth.ts`) instead of trusting a client-supplied `userId`/`teamId`. `publishing-service` and `analytics-service` are internal-only (called by the worker/cron, not the browser) and don't need this.
- **Frontend no longer hardcodes `localhost`.** API calls use env-var-driven URLs and attach the verified session token (`authHeader()` in `apps/web/src/lib/supabase.ts`).
- **`ENCRYPTION_KEY` now fails fast instead of silently falling back to an insecure default** — see the Setup section below.

## ✨ What works today

| Area | State |
|---|---|
| Auth (email/password via Supabase) | Works. No email-confirmation UI, no password reset. |
| Teams / roles | Auto-created team on first signup (custom team name supported), roles `owner/admin/editor/viewer`, invite existing users. No member removal or role editing yet. |
| Compose / preview | Per-platform preview cards, image/video upload, automatic per-platform crop (e.g. 9:16 for Reels/Shorts), Reel/Standard toggle. |
| Scheduling | Calendar (month/week view, click a day to create, click a post to edit its caption) + list/timeline view. Delayed jobs via Redis + BullMQ. |
| Publishing | Background worker with automatic retries (3 attempts, backoff) and a manual "Retry failed" action; in-app + bell notifications on success/failure. |
| Analytics | Backend sync exists for YouTube, Pinterest, Threads; UI surfacing is limited. |

## 🌐 Platform integration status

| Platform | Connect (OAuth) | Publish | Notes |
|---|---|---|---|
| Facebook (Pages) | ✅ Works (for test users, see caveat above) | ✅ Text, photo, Reel | Always uses the first Page; no page picker. |
| Instagram (Business) | ✅ Works (for test users) | ✅ Image, Reel | Same caveat; image/Reel only, no carousel. |
| YouTube | ✅ Works (for test users) | ✅ Resumable upload, Shorts tag | Most complete integration; the only one with token refresh. |
| Threads | ✅ Works (for test users) | ✅ Text/image/video | Code-complete but lightly tested with real accounts; analytics need a scope that isn't requested yet. |
| Pinterest | ✅ Works | ⚠ Likely media-URL bug on video pins | Boards import/create works; analytics work. |
| Twitter / X | ✅ Works | ⚠ Text only | No media, no analytics. |
| LinkedIn | ❌ Not usable | ❌ | OAuth callback stores a mock token — nothing is actually published. |
| TikTok | ❌ Stub | ❌ | Connect and publish are both simulated; fails honestly now instead of reporting false success. |

## 🏗️ Architecture & tech stack

- **Frontend:** Next.js (App Router), React, Tailwind CSS, TypeScript, FullCalendar — `apps/web`
- **Backend:** Node.js + Express, TypeScript, microservices — one npm workspace per service under `services/`
- **Database / Auth / Storage:** Supabase (Postgres + Row Level Security + Auth + a public storage bucket for media)
- **Queue:** Redis + BullMQ (delayed scheduling, retries, background sync)
- **Media processing:** `sharp` (images), `ffmpeg` (video, per-platform aspect-ratio cropping)

### Services (monorepo, npm workspaces: `apps/*`, `services/*`, `packages/*`)

```
apps/web/                     Next.js dashboard (login, posts, calendar, accounts, settings)
services/account-service      OAuth connect/disconnect, token encryption               :3001
services/post-service         Post CRUD, feed/calendar queries, caption edit            :3002
services/publishing-service   Platform adapters (Facebook/Instagram/YouTube/...)        :3003
services/scheduling-service   Creates schedules + BullMQ delayed jobs                   :3004
services/media-service        Upload, per-platform image/video variants                 :3006
services/analytics-service    Cron sync of per-platform stats (every 5 min)             :3008
services/team-service         Teams, invites, (mock) billing                            :3009
services/worker               BullMQ consumer that calls publishing-service             (no port)
services/notification-service BullMQ consumer that writes in-app notifications          (no port)
packages/shared                Redis/BullMQ helpers, role cache, rate limiter (@socialpush/shared)
supabase/migrations            Database schema, as a sequence of SQL migrations
docs/                           Detailed, actively-maintained project documentation
```

## 🚀 Running locally

### Prerequisites
- Node.js 18+
- A Supabase project (Postgres + Auth + Storage)
- A Redis instance reachable over the network (a free [Upstash](https://upstash.com) database works well; `infra/docker-compose.yml` also starts a local one)
- For testing OAuth connects: a public HTTPS tunnel to your machine (e.g. `cloudflared tunnel --url http://localhost:3001`), since Meta/Google require HTTPS redirect URIs

### Setup
1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/00developer/social-media-posting.git
   cd social-media-posting
   npm install
   ```
   (There is intentionally no committed `package-lock.json` — see [Note on lock files](#note-on-lock-files).)
2. Build the shared package (services import its compiled output):
   ```bash
   npm run build -w @socialpush/shared
   ```
3. Copy `.env.example` to `.env` in the repo root and fill in your own values. Every backend service loads this same root `.env`. Keys used across the codebase:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `REDIS_URL` (and optionally `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` for caching/rate-limiting)
   - `ENCRYPTION_KEY` (exactly 32 characters — encrypts stored OAuth tokens at rest. **Required, no fallback**: `account-service`/`publishing-service`/`analytics-service` refuse to start without it. Don't change it after tokens have been stored, or existing tokens become undecryptable and every connected account needs reconnecting.)
   - `API_BASE_URL` (your public tunnel/deployment URL — used to build every OAuth redirect URI)
   - Per platform, as needed: `FACEBOOK_APP_ID/SECRET`, `THREADS_CLIENT_ID/SECRET`, `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`, `TWITTER_CLIENT_ID/SECRET`, `LINKEDIN_CLIENT_ID/SECRET/REDIRECT_URI`, `PINTEREST_CLIENT_ID/SECRET/REDIRECT_URI`
4. `apps/web` needs its own `apps/web/.env.local` (the frontend does **not** read the root `.env`):
   ```
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   ```
5. Run every service + the frontend together:
   ```bash
   npm run dev:all
   ```
6. Open `http://localhost:3000`.

For each OAuth provider you want to test, register `<API_BASE_URL>/api/v1/auth/<platform>/callback` as its redirect URI in that provider's developer console, and (while the app is in test/development mode) add your own account as a test user there.

### Note on lock files
`package-lock.json` is intentionally **not** committed (see `.gitignore`). A lock file generated on Windows pins platform-specific optional dependencies (e.g. `lightningcss`, `@next/swc`) to their Windows builds; installing from that same lock file on Vercel's Linux build image then fails because the Linux build was never recorded in it. Each environment resolves and locks its own dependencies on `npm install`.

## 📦 Deploying

**Docker (recommended — covers the whole stack).** The repo has a Dockerfile for every service plus a `docker-compose.yml` that wires all 10 containers together:
- Root `Dockerfile` is generic and builds any one backend service via a build arg, e.g. `docker build --build-arg SERVICE=account-service -t account-service .` (it needs the whole repo as build context — npm workspace hoisting requires the full tree, not just that service's folder).
- `apps/web/Dockerfile` builds the Next.js frontend using `output: 'standalone'`; it needs the `NEXT_PUBLIC_*` vars as **build args** (baked in at build time, not read at runtime) — see the comments at the top of `docker-compose.yml` and `.env.example`.
- `docker compose up --build` runs the whole stack locally from those images. For a real deployment (e.g. [Coolify](https://coolify.io), or any Docker-capable host), point it at this repo's `docker-compose.yml` as a **Docker Compose resource** (not a single Dockerfile app — the stack is 10 separate services) and set every variable from `.env.example` as a real environment variable in that platform's dashboard (`.env` itself is gitignored and never committed).
- Every backend service needs a **stable public `API_BASE_URL`** once deployed — this is what gets registered as the OAuth redirect base with Meta/Google/LinkedIn/Pinterest. A temporary tunnel (like `cloudflared`'s free quick-tunnel) generates a new random URL on every restart, which breaks OAuth until you update it everywhere again; a real deployment's fixed domain avoids that entirely.

**Frontend only → Vercel** also still works if you only want to preview the UI: import this repo, set the project's **Root Directory to `apps/web`**, and add the `NEXT_PUBLIC_*` environment variables in the Vercel project settings. The backend still needs to be deployed separately (Vercel can't host the nine always-on `services/*` or the BullMQ worker) and reachable at a real URL for the app to actually work, not just render pages.

## 🐛 Known issues

`docs/KNOWN_ISSUES.md` has the full, itemized list (security gaps, functional bugs, deployment/config issues, code quality). The highlights are covered under [Before you deploy](#-before-you-deploy-this-or-share-a-live-link) above.

## 🔐 Security note

OAuth tokens are encrypted at rest before being stored (`ENCRYPTION_KEY`, required — see Setup above). Row Level Security on Supabase restricts each user to their own team's data *in the database*, and the backend services that face the browser (`account-service`, `team-service`, `post-service`, `scheduling-service`, `media-service`) now verify the caller's Supabase session server-side before trusting any `userId`/`teamId`. CORS is still wide open on every service (see [Before you deploy](#-before-you-deploy-this-or-share-a-live-link) above) — worth adding an origin allowlist before treating this as production-hardened.

---
*Read [`docs/RESUME_HERE.md`](docs/RESUME_HERE.md) for the most up-to-date snapshot of in-progress work.*
