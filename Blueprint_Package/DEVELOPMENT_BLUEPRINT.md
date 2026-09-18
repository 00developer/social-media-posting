# Development Blueprint
## Multi-Platform Social Media Publishing & Scheduling SaaS ("SocialPush")

> Companion document to `SocialPush_Project_Blueprint.docx`. That document describes **what** the product is. This document describes **how and in what order** to build it, plus the rules to follow while building. **Updated to use Supabase** as the managed backend for auth, database, and storage.

---

## 1. Purpose of This Document

This is a build guide, meant to be followed top to bottom (by a dev team, a solo builder, or fed directly to an AI coding assistant). It defines the final tech stack, the order features should be built in (MVP → full architecture), a task checklist per phase, non-negotiable engineering rules, repo structure, and API conventions.

The full architecture in the Blueprint document (Kubernetes, multi-region, full RBAC, teams, billing) is the **target end state**, not the starting point.

> ⚠️ **Read this before anything else — the one distinction that matters most:**
> - **Supabase Auth** = login for people *using SocialPush* (the app's own users).
> - **Account Service (fully custom, not Supabase)** = the OAuth connection to *external* platforms (Instagram, Facebook, YouTube, X) so SocialPush can publish on a user's behalf.
>
> These are two completely different OAuth flows, two different sets of tokens, two different purposes. Supabase has nothing to do with the second one. Do not conflate them.

---

## 2. Final Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend (web) | React / Next.js | Dashboard + marketing site |
| Frontend (mobile) | React Native | Build after web MVP is stable |
| **App authentication** | **Supabase Auth** | Replaces a custom User Service entirely — signup, login, session, password reset, optional Google OAuth for app login |
| **Database** | **Supabase (managed PostgreSQL)** | Replaces a self-hosted Postgres instance. Row Level Security (RLS) enforced on every user-data table |
| **Object storage** | **Supabase Storage** | Replaces S3/R2 for original + processed media. S3-compatible under the hood |
| Backend (custom) | Node.js + TypeScript | One deployable per service — Account, Post, Media, Scheduling, Publishing, Analytics. Supabase does **not** replace any of these |
| API Gateway | Nginx (simple) → Kong later | Sits in front of the custom Node services only; Supabase's own API (PostgREST) is called directly by the frontend for simple CRUD |
| Cache / Queue | Redis + BullMQ | Sessions for job state, rate limiting, the scheduling/publishing job queue — Supabase has no equivalent, this stays fully custom |
| CDN | Supabase Storage CDN, or Cloudflare in front | Media delivery |
| Containers | Docker | From day one, even locally |
| Orchestration | Docker Compose (local/staging) → Kubernetes (scale phase) | Don't adopt K8s before you need it |
| CI/CD | GitHub Actions | Build/test/deploy pipeline from phase 0 |
| Monitoring | Sentry (errors) + Supabase's built-in dashboard/logs | Add Prometheus/Grafana only in the scale phase |

### What Supabase removes from your build list
- A custom User Service (password hashing, JWT issuing, session storage, OAuth-for-login)
- Hosting and operating your own PostgreSQL instance
- A separate object storage + CDN setup

### What stays exactly the same, Supabase or not
- Redis + BullMQ job queue and all scheduling/publishing logic
- Account Service (external platform OAuth + encrypted token storage)
- Post, Media, Scheduling, Publishing, Analytics services
- Platform adapters, the state machine, retries, workers
- Docker, CI/CD, monitoring, Kubernetes at scale

---

## 3. Engineering Rules & Instructions

These rules apply to every phase below. They are not optional.

### 3.1 Code Organization
- Monorepo with one folder per custom service under `/services/*`; shared types/utilities in `/packages/shared`.
- No custom service reaches into another service's data directly except through Supabase (shared DB) with proper RLS, or through an explicit API call/event — never bypass RLS from anywhere except a trusted backend service using the service role key.
- No business logic in controllers/route handlers — routes call a service/use-case layer, which calls the data layer.

### 3.2 Supabase Usage Rules
- The **Supabase anon key** is the only Supabase key ever shipped to the frontend. It relies entirely on Row Level Security to keep data safe.
- The **Supabase service role key** (which bypasses RLS) lives only in backend environment variables for the custom Node services (Scheduling, Publishing, Media workers) that must act on behalf of many users (e.g. a worker publishing scheduled posts for everyone). It is never exposed to the frontend, never logged, never committed.
- Any custom Node service using the service role key must still perform its own ownership/permission checks in code — RLS is bypassed, so the application is now responsible for that safety instead.
- Enable Row Level Security on every table that holds user data, from the first migration that creates it. A table with RLS disabled "temporarily to move fast" is not acceptable — write the policy at the same time as the table.
- All schema changes are Supabase CLI migrations, checked into version control (`supabase migration new ...`) — never edited by hand in the Supabase dashboard for anything beyond local experimentation.

### 3.3 API Design
- REST, versioned from the start: `/api/v1/...` for the custom Node services. Simple CRUD reads that don't need custom logic can go straight from the frontend to Supabase's auto-generated API, protected by RLS.
- Every custom endpoint validates input with a schema validator (e.g. Zod) before touching the database.
- Consistent response shape: `{ success, data, error }`.
- Paginate any endpoint that returns a list.

### 3.4 Database Rules
- Every table gets `id (UUID)`, `created_at`, `updated_at`.
- Foreign keys enforced at the DB level.
- Index every column used in a `WHERE`, `JOIN`, or `ORDER BY` on a table expected to grow (posts, schedules, publish_jobs, analytics).
- `auth.users` (managed by Supabase Auth) is the source of truth for app users — application tables reference it via `user_id uuid references auth.users(id)`, they do not duplicate a `users` table.

### 3.5 Security Rules (non-negotiable)
- OAuth access/refresh tokens for **connected external social accounts** (Instagram/Facebook/YouTube/X) are encrypted at the application level before being written to Supabase — never stored in plaintext, even though the database itself is managed.
- Supabase Auth already handles password hashing — do not build or store your own password hashes anywhere.
- All secrets (Supabase service role key, encryption keys, platform API credentials) live in environment variables / a secrets manager — never committed to the repo.
- Every custom endpoint that touches user data checks that the authenticated user owns that resource, in addition to whatever RLS is doing.
- Rate-limit publicly reachable endpoints, especially anything auth-adjacent.

### 3.6 Git & Commit Rules
- Branch per feature: `feature/<short-description>`, `fix/<short-description>`.
- Commit messages: `type: short description` (`feat: add instagram publish adapter`, `fix: retry logic off-by-one`).
- No direct commits to `main` — pull request + at least a self-review/checklist before merge.
- CI (lint + test + build) must pass before merge.

### 3.7 Testing Rules
- Every custom service ships with unit tests for its business logic before it's considered "done."
- Platform adapters (Instagram/Facebook/YouTube/X) get integration tests against sandbox/test accounts where available.
- The publishing pipeline (upload → schedule → queue → publish → status update) gets at least one end-to-end test per supported platform.
- Add a test that verifies RLS actually blocks cross-user access — not just that it exists in a migration file.

### 3.8 Error Handling Rules
- Every external call (social platform API, Supabase, payment provider) is wrapped with a timeout and a retry policy (exponential backoff, max attempts).
- Failures are never swallowed silently — log them with enough context (post ID, platform, user ID) to debug without reproducing.
- User-facing errors are translated into plain-language messages; raw stack traces never reach the frontend.

### 3.9 Environment & Config Rules
- Three environments minimum: `local`, `staging`, `production` — each with its **own Supabase project** and its own Redis instance.
- No feature ships straight to production without having run in staging first.
- Feature flags for anything risky (new platform adapter, new billing flow) so it can be turned off without a redeploy.

---

## 4. Core Working Logic

Read this before writing any code beyond Phase 1 — it's the runtime logic that ties the whole architecture together. Supabase does not change any of this; it only changes where users, auth sessions, and media files live.

1. **Single Source, Multiple Derivatives** — the original upload (in Supabase Storage) is stored once and never modified; every platform variant is derived from it, so reprocessing is always possible.
2. **Fan-Out Logic (Post ≠ Job)** — one post targeting 3 platforms creates 3 independent jobs. A failure on one platform never blocks the others.
3. **Decoupled Time Logic** — the Scheduling Service only converts the user's local time to UTC and creates a delayed job; it has no knowledge of who executes it.
4. **Pull-Based Queue & Worker Logic** — one worker type per platform polls the queue and pulls jobs once due; workers run in parallel.
5. **Adapter Pattern** — the core publishing logic never contains platform-specific code; each platform implements `prepareMedia()`, `publish()`, `getStatus()`. Adding a platform = adding one adapter.
6. **State Machine** — `Draft → Scheduled → Processing → Publishing → Published`, with `Publishing → Failed → Retry (backoff) → back to queue` on failure.
7. **Smart Retry** — temporary errors (timeout, rate limit) auto-retry with backoff; permanent errors (expired token, invalid content) stop and notify the user instead of retrying blindly.
8. **Aggregate Status** — a post's displayed status is derived from all of its per-platform job statuses (e.g. "Partially Published" when 2 of 3 succeed).
9. **Event-Driven Notifications** — publish success/failure fires an event; the Notification Service reacts to it. Publishing logic has zero knowledge that notifications exist.
10. **Analytics Pull** — a separate periodic job pulls metrics per platform after publish and writes them as time-series data.

**In one line:** Upload → N platform variants → N independent jobs → UTC-scheduled trigger → parallel adapter-based workers → per-job status → aggregate status + events + periodic analytics pull. Every layer is decoupled so a slow or broken part never stalls the rest.

---

## 5. Build Phases (Order of Development)

### Phase 0 — Project Setup
- [ ] Monorepo scaffolded (`/services`, `/packages/shared`, `/apps/web`)
- [ ] Supabase project created (Auth + Database + Storage); Email/Password provider enabled
- [ ] Supabase CLI installed; first migration committed to version control
- [ ] Docker Compose for local dev — Redis (Supabase itself is cloud-hosted; a local Supabase stack via `supabase start` is optional, not required)
- [ ] `.env.example` documented: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (frontend-safe), `SUPABASE_SERVICE_ROLE_KEY` (backend-only, never exposed)
- [ ] GitHub Actions: lint + test + build on every PR
- [ ] Base Next.js app with `@supabase/supabase-js` wired up, an auth-guarded shell (empty dashboard, login page using Supabase Auth)

**Goal:** an empty but deployable skeleton where a test user can already sign up and log in through Supabase Auth.

### Phase 1 — MVP Core (single platform, manual publish)
- [ ] **No custom User Service** — Supabase Auth handles signup/login/session directly from the frontend SDK; custom Node services verify the Supabase-issued JWT for any request that needs to know who's calling
- [ ] `social_accounts` and `posts` tables created via migration, RLS enabled, policy: a user can only see/edit rows where `user_id = auth.uid()`
- [ ] **Account Service** (custom, Node/TypeScript) — implements OAuth against **one** external platform first (recommend X or Facebook): redirect to consent screen → receive callback → exchange code for tokens → encrypt tokens at the application level → store in `social_accounts` via the Supabase service role key
- [ ] **Post Service** (custom) — create a post (text + single image), save as Draft in the `posts` table
- [ ] **Publishing Service** (custom) — publish a Draft post immediately (no scheduling yet) using the connected account's decrypted token
- [ ] Minimal dashboard UI: login (Supabase Auth), connect account (kicks off Account Service OAuth), create post, publish now, see status

**Goal:** a real user signs up via Supabase Auth, logs in, connects one real external account, and publishes one real post to it end to end.

### Phase 2 — Scheduling + Job Queue
- [ ] Redis + BullMQ wired in (unaffected by Supabase)
- [ ] `schedules` and `publish_jobs` tables in Supabase Postgres, RLS enabled
- [ ] Scheduling Service: pick a future date/time, convert to UTC, create a delayed job
- [ ] Background worker consumes the queue, uses the Supabase service role key to read the job + decrypt the token, and calls the Publishing Service at the right time
- [ ] Post state machine implemented: Draft → Scheduled → Processing → Publishing → Published / Failed
- [ ] Retry logic with backoff on failed publish attempts
- [ ] Dashboard shows scheduled posts and their status (via Supabase client, real-time subscription optional)

**Goal:** posts can be scheduled ahead of time and publish automatically and reliably.

### Phase 3 — Multi-Platform + Media Processing
- [ ] Add Instagram and YouTube adapters (repeat the adapter pattern from Phase 1)
- [ ] Media Service: detect media type, validate size/dimensions
- [ ] Auto-generate platform-specific variants (aspect ratio, compression) on upload
- [ ] **Supabase Storage** bucket created for media (e.g. path pattern `media/{user_id}/{post_id}/...`), with Storage policies restricting each user to their own path
- [ ] One post can target multiple platforms in a single schedule; one worker per platform runs in parallel

**Goal:** the core "Upload Once → Schedule Once → Publish Everywhere" promise is fully working across at least 3 platforms.

### Phase 4 — Analytics & Notifications
- [ ] Analytics Service — pull post performance from each platform's API on a schedule, write to an `analytics` table (RLS enabled)
- [ ] Analytics dashboard — views, likes, reach, top-performing posts
- [ ] Notification system — email + in-app for publish success/failure, triggered by a publish event (not called directly from publishing code)
- [ ] Webhook support (optional, for power users/integrations)

**Goal:** users can see how their posts perform without leaving the dashboard.

### Phase 5 — Teams, Roles & Billing
- [ ] `teams` + `team_members` tables, invite flow, RLS policies keyed on team membership (not just `user_id`)
- [ ] Role-based access control (Owner / Admin / Editor / Viewer) enforced both in RLS policies and in custom endpoint checks
- [ ] Subscription plans + billing integration (e.g. Stripe — fully custom, Supabase has no billing feature)
- [ ] Usage limits enforced per plan (number of connected accounts, posts/month)

**Goal:** the product is sellable as a team subscription, not just single-user.

### Phase 6 — Scale & Infrastructure
- [ ] Move the custom Node services from Docker Compose to Kubernetes (Supabase itself scales via its own managed plan tiers — this phase is about your services, not about replacing Supabase)
- [ ] Evaluate Supabase's connection pooling / plan limits under real load before considering anything more drastic
- [ ] Full monitoring stack for the custom services: Prometheus + Grafana + centralized logs (ELK/Loki) + tracing
- [ ] Multi-region storage/CDN if user base is geographically spread
- [ ] Add remaining platforms: LinkedIn, TikTok, Pinterest

**Goal:** the system matches the full target architecture in the Blueprint document.

---

## 6. Definition of Done (applies to every phase)

A phase is not "done" until:
1. All checklist items are implemented **and** covered by at least basic tests.
2. It has run in `staging` (its own Supabase project) without errors for real test accounts on each platform involved.
3. Secrets/config for the new functionality are documented in `.env.example`.
4. RLS policies for any new table have been tested to actually block cross-user access, not just assumed to work.
5. The dashboard reflects the new functionality (no backend-only features with no UI).
6. Errors are logged and surfaced to the user in plain language, not just in server logs.

---

## 7. Suggested Repo Structure

```
/apps
  /web              → Next.js dashboard (Supabase client + custom API calls)
  /mobile           → React Native app (Phase 5+)
/services
  /account-service      → external platform OAuth + token storage (NOT Supabase Auth)
  /post-service
  /media-service
  /scheduling-service
  /publishing-service
  /analytics-service
/packages
  /shared           → shared types, validators, constants
/supabase
  /migrations       → versioned SQL schema + RLS policy changes
/infra
  /docker-compose.yml   → Redis + custom services for local dev
  /k8s               → added in Phase 6
.github/workflows    → CI/CD pipelines
```

Note there is **no `/services/user-service`** — that responsibility belongs to Supabase Auth.

---

## 8. Platform Adapter Build Order (recommended)

Build in this order — easiest/most-documented APIs first, so the adapter *pattern* is proven before tackling trickier platforms:

1. **X (Twitter)** — simplest post + media API
2. **Facebook** — Graph API, well documented
3. **Instagram** — Graph API, but requires a linked Facebook Page + business account (more setup friction)
4. **YouTube** — video upload API, resumable uploads needed for larger files
5. **LinkedIn / TikTok / Pinterest** — Phase 6, add using the same adapter interface

Every adapter should implement the same interface (`prepareMedia`, `publish`, `getStatus`) so the Publishing Service and workers don't need platform-specific branching outside the adapter itself. None of this changes with Supabase — adapters are pure external-API integrations.

---

*End of Development Blueprint. Refer to `SocialPush_Project_Blueprint.docx` for the full target-state architecture, wireframes, and diagrams referenced throughout this plan, and to `ANTIGRAVITY_DEVELOPMENT_PROMPT.md` for the agent-ready build prompt.*
