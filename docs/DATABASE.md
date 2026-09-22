# Database (Supabase Postgres)

Source: `supabase/migrations/*.sql` (16 files) reconciled against the columns the code actually reads/writes. The Supabase project in `.env` is a **cloud project** (`*.supabase.co`), while `PROGRESS_REPORT.md` says one migration was "applied to the local Supabase instance" — so **which DB has which migration applied is unknown**. First task for anyone taking over: run `supabase db diff` / `supabase migration list` against the target DB.

## 1. Tables

### `social_accounts` — connected platform accounts
| Column | Notes |
|---|---|
| `id uuid PK` | |
| `user_id → auth.users` | who connected it |
| `team_id → teams` (nullable) | added in phase 5; the UI filters by it |
| `platform text` | CHECK (recreated by later migrations): `twitter, facebook, instagram, youtube, linkedin, tiktok, pinterest, threads` |
| `access_token_encrypted text NOT NULL`, `refresh_token_encrypted text` | AES-256-CBC `ivHex:cipherHex`. For Meta/Threads the refresh column stores `encrypt('none')` |
| `channel_id`, `channel_title` | added by YouTube migration; **never written by any code** |
| `target_type` (`member`/`organization`, default `member`), `organization_urn` | LinkedIn; never written (LinkedIn callback is mock) |
| `refresh_token_expires_at timestamptz` | LinkedIn migration; written only by Pinterest (now+60 d); the UI warns only for `linkedin` |
| ⚠ `provider_account_id`, `handle`, `status` | **Used by code (Pinterest insert, LinkedIn adapter) but not created by any migration** |
| `created_at`, `updated_at` (trigger) | |
No unique constraint on `(team_id, platform)`.

### `posts`
`id, user_id, team_id, content text, media_url text, status text default 'draft', created_at, updated_at`.
- `media_url` = JSON string `{ "<platform>": "<public url>" }` (or `{}`), not a plain URL.
- `status` values seen in code: `draft, scheduled, processing (YouTube adapter only), published, failed`; the frontend also fakes `uploading`. No CHECK constraint.
- ⚠ `media_variants` is referenced by the Pinterest adapter (`post.media_variants?.pinterest`) but **no such column exists in migrations**.

### `schedules` — one row per (post, platform) per scheduling action
`id, post_id → posts (cascade), user_id, platform, scheduled_at timestamptz, timezone text, created_at, updated_at`. Index `idx_schedules_scheduled_at` (migration 20260919000000). Re-scheduling/retrying **adds rows**; nothing deletes old ones.

### `publish_jobs` — one row per platform job (mirrors the BullMQ job)
`id (== BullMQ jobId), post_id, user_id, platform, status default 'scheduled', retry_count int, error_message, content_type ('post'|'reel', default 'post'), pinterest_board_id text (never written), queue_job_id text (added 2026-09-19, **never written**), created_at, updated_at`.
Status vocabulary in code: `scheduled → processing → completed | failed`. No CHECK.

### `analytics`
`id, post_id, user_id, team_id (added phase 5), platform, likes, shares, views, recorded_at`. One logical row per (post, platform) updated in place (no unique constraint enforces it; code does select-then-update/insert). `shares` is overloaded (comments for YouTube, clicks for Pinterest, replies+reposts+quotes for Threads).

### `notifications`
`id, user_id, type ('success'|'failure'), message, read default false, created_at`.

### `teams` / `team_members`
`teams(id, name, plan default 'free' /* 'free'|'pro' */, created_at)`; `team_members(id, team_id, user_id, role CHECK in owner/admin/editor/viewer, UNIQUE(team_id,user_id))`.
Phase-5 migration auto-created a "My Team" per pre-existing user and back-filled `team_id` on `social_accounts`, `posts`, `analytics`.

### Platform-specific
- `youtube_upload_sessions(id, post_id, user_id, session_uri, bytes_uploaded, status in_progress|completed|failed, video_id, timestamps)`. Used for resumable upload state and by analytics.
- `pinterest_boards(id, social_account_id, user_id, pinterest_board_id, board_name, is_default, UNIQUE(social_account_id, pinterest_board_id))`.
- `pinterest_published_pins(post_id PK, pin_id, user_id, created_at)` — one pin per post; `PRIMARY KEY (post_id)` means a second Pinterest publish of the same post insert-fails (error is not checked).

### Storage
Bucket `post_media` (public read). Path convention `<userId>/<random-uuid>/<platform>.<jpg|mp4>`. RLS: owner-prefix insert/update/delete; anyone can read. (media-service uses the service role, so these only matter for direct client uploads, which the app does not do.)

## 2. Relationships
```
auth.users ─┬─< team_members >─ teams
            ├─< social_accounts (team_id) ──< pinterest_boards
            ├─< posts (team_id) ─┬─< schedules
            │                    ├─< publish_jobs
            │                    ├─< analytics
            │                    ├─< youtube_upload_sessions
            │                    └─1 pinterest_published_pins
            └─< notifications
```
All child FKs are `ON DELETE CASCADE`.

## 3. Row Level Security — what is actually true
| Table | Policy basis after all migrations |
|---|---|
| `social_accounts`, `posts` | **Team-based** (view: any member; insert/update: owner/admin/editor; delete accounts: owner/admin). ⚠ `posts` "Users can delete their own posts" (user-based) was *not* dropped, so the delete policy is still `auth.uid() = user_id`. |
| `teams`, `team_members` | SELECT for members; UPDATE (teams) owner; ALL (team_members) owner/admin. **No INSERT policy on `teams`**, and no policy letting a fresh user insert their own first membership. |
| `schedules`, `publish_jobs`, `analytics`, `notifications` | **Still user-scoped** (`auth.uid() = user_id`). |
| `youtube_upload_sessions`, `pinterest_boards` | `user_id = auth.uid()` |
| `pinterest_published_pins` | user-scoped CRUD |

**Verified on the live cloud DB (2026-09-21):** despite the migrations above, the logged-in owner sees 0 rows in `schedules`, `publish_jobs`, `notifications`, `analytics` (their SELECT policies are missing/not effective), while `posts`, `social_accounts`, `team_members`, `teams` work. `20260921000000_restore_read_policies.sql` restores own-row SELECT policies; apply it in the SQL editor.

**Also verified (2026-09-21):** the `trigger_set_timestamp` `updated_at` trigger has no effect on `posts` on the live DB (an UPDATE keeps the old `updated_at`). Treat `updated_at` as unreliable unless the writer sets it.

Consequences:
1. The frontend's `posts` select embeds `publish_jobs(*)` and (calendar path) `schedules`; for posts created by a *teammate*, those embedded rows are filtered out by user-scoped RLS → teammates see other people's posts without job status/errors.
2. `team_members` policies query `team_members` from within its own policies — a classic source of "infinite recursion detected in policy" errors on Supabase. The app evidently worked for the previous developer, so the live DB probably differs (e.g. security-definer helpers). **Verify against the live DB before changing RLS.**
3. The first-login auto-team creation in the browser (`DashboardProvider.fetchUserTeams`) requires INSERT rights that the migrations do not grant. Same caveat.
4. All microservices use the **service-role key**, so RLS does not protect the write path at all.

## 4. Migration inventory
| File | Content |
|---|---|
| `20260916000000_initial_setup` | empty placeholder |
| `…000001_phase_1_tables` | `social_accounts`, `posts`, `trigger_set_timestamp()` |
| `…000002_phase_2_tables` | `schedules`, `publish_jobs` |
| `…000003_phase_3_storage` | `post_media` bucket + policies |
| `…000004_phase_4_tables` | `analytics`, `notifications` |
| `…000005_phase_5_teams` | teams, members, `team_id`, data back-fill, RLS rewrite |
| `20260916080655_initial_setup`, `20260916081705_initial_setup` | **empty files** |
| `20260918000000_youtube_integration` | account cols + `youtube_upload_sessions` |
| `…000001_youtube_video_id` | `video_id` |
| `…000002_reels_content_type` | `publish_jobs.content_type` |
| `…000003_linkedin_schema` | `target_type`, `organization_urn`, `refresh_token_expires_at` |
| `…000004_pinterest_schema` | platform CHECK (adds pinterest), `pinterest_boards`, `publish_jobs.pinterest_board_id` |
| `…000005_pinterest_analytics` | `pinterest_published_pins` |
| `20260919000000_queue_job_id` | `publish_jobs.queue_job_id`, `idx_schedules_scheduled_at` — **untracked file** |
| `20260919000001_threads_schema` | platform CHECK adds `threads` — **untracked file, reported "pending application"** |

`scratch_init.sql` (repo root) is a concatenation of the early migrations (a scratch artifact). Do not use it as a source of truth.

## 5. Redis keys (not SQL, but data)
`team_role:<teamId>:<userId>` (Upstash, TTL 300 s) · `feed:<teamId>` and `feed:<teamId>:range:<from>:<to>` (TTL 60 s) · `analytics:<postId>:<platform>:<views|likes|shares>` (counters) · BullMQ queues `publish-queue`, `notifications-queue`, `analytics-queue` · Upstash ratelimit prefix `@upstash/ratelimit` (`publish_<userId>`).
