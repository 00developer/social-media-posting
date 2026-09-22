# SocialPush 🚀

SocialPush is a multi-platform social media scheduling and publishing tool ("write once, publish everywhere"). A user (or team) connects social accounts via OAuth, composes a post with an optional image/video, picks target platforms, and either publishes immediately or schedules it for later. A background worker publishes through per-platform adapters and notifies the user of the result; analytics are pulled back periodically.

This README describes the **actual current state** of the project (verified by reading the code and, in several places, by testing against the real database), not an aspirational feature list. For the full, more detailed picture see [`docs/`](docs/) — start with [`docs/PROJECT_OVERVIEW.md`](docs/PROJECT_OVERVIEW.md), [`docs/CURRENT_STATE.md`](docs/CURRENT_STATE.md) and [`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md).

## ⚠️ Before you deploy this or share a live link

This project is not yet in a state where a stranger can open a deployed link and fully use it end-to-end. Specifically:

1. **The frontend's API calls are hardcoded to `http://localhost:<port>`.** Deploying `apps/web` to Vercel makes the *pages* load, but every API call (create post, connect account, etc.) still tries to reach `localhost` — which doesn't exist on Vercel's servers. This must be replaced with a real backend URL (env var) before a Vercel deployment is actually usable.
2. **Vercel cannot host the backend.** Nine Node/Express services + a persistent BullMQ worker make up the backend (see [Architecture](#architecture--tech-stack)); several of them are always-on processes, which serverless platforms like Vercel don't support. They need a host built for long-running processes (Railway, Render, Fly.io, a VPS, etc.).
3. **No backend authentication.** Every backend service trusts whatever `userId`/`teamId` is sent in the request body and uses a service-role (RLS-bypassing) database client; CORS is wide open (`*`). This is fine on `localhost` for development, but the backend must **not** be exposed on the public internet as-is — anyone who can reach it can act as any user. See [`docs/KNOWN_ISSUES.md`](docs/KNOWN_ISSUES.md) #1–4.
4. **OAuth apps are in test/development mode.** The Facebook/Instagram/Threads app (Meta) and the Google Cloud project (YouTube) are not yet through their respective app review / verification processes. Until that's done, **only accounts explicitly added as test users in those consoles can connect** — a real outside user trying to connect their own Facebook, Instagram, YouTube or Threads account will hit an "access blocked" / "can't load URL" style error. This is a third-party platform restriction, not a bug in this code.
5. **Two integrations are not real:** LinkedIn's OAuth callback stores a mock token (nothing published actually reaches LinkedIn), and TikTok is fully stubbed (connect and publish are both simulated). Both currently still appear as normal "Connected" platforms in the UI.

None of this blocks pushing the code or deploying the frontend for a first look at the UI — it does mean "let anyone fully test it live" needs the fixes above first (this is exactly why the previous deployment attempt only had the frontend working).

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
   - `ENCRYPTION_KEY` (32 characters — encrypts stored OAuth tokens; **set your own**, don't rely on the code's fallback)
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

- **Frontend (`apps/web`) → Vercel:** import this repo, set the project's **Root Directory to `apps/web`**, and add the `NEXT_PUBLIC_*` environment variables in the Vercel project settings.
- **Backend → not Vercel.** Use a host that supports long-running Node processes (Railway, Render, Fly.io, a VPS/Docker host...) for the nine services under `services/`. Whichever you choose, you'll still need to fix the hardcoded `localhost` URLs in the frontend (point #1 above) so it calls your deployed backend instead.

## 🐛 Known issues

`docs/KNOWN_ISSUES.md` has the full, itemized list (security gaps, functional bugs, deployment/config issues, code quality). The highlights are covered under [Before you deploy](#-before-you-deploy-this-or-share-a-live-link) above.

## 🔐 Security note

OAuth tokens are encrypted at rest before being stored. Row Level Security on Supabase restricts each user to their own team's data *in the database* — but see point 3 above: the backend services themselves don't yet enforce this independently, so they should stay behind a trusted boundary (e.g. `localhost`, or a private network) until that's addressed.

---
*Read [`docs/RESUME_HERE.md`](docs/RESUME_HERE.md) for the most up-to-date snapshot of in-progress work.*
