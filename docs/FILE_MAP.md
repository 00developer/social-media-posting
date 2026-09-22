# File Map

Risk: 🟢 safe to edit · 🟡 coupled, edit carefully · 🔴 do not change casually.

## Root
| Path | Purpose | Risk |
|---|---|---|
| `package.json` | workspaces + `dev:*` scripts (`dev:all` runs everything with `concurrently`) | 🟡 |
| `.env` | secrets for all services (git-ignored). Never print/commit | 🔴 |
| `.env.example` | stale template | 🟢 |
| `README.md` | marketing-style overview (lists TikTok as supported; no Threads/Calendar) | 🟢 |
| `PROGRESS_REPORT.md` | Calendar progress (Step 1 done) | 🟢 (keep in sync) |
| `THREADS_PROGRESS_REPORT.md` | Threads progress — **stale** | 🟢 |
| `imple/` | Calendar spec + Antigravity prompt (untracked) — the requirements for calendar Steps 2–4 | 🟡 keep |
| `thread/` | Threads spec + prompt (untracked) | 🟡 keep |
| `Blueprint_Package/`, `*-integration/` | original requirements (deleted in worktree, in git) | 🟡 recover before deleting for good |
| `scratch_init.sql` | concatenated early migrations, scratch | 🟢 delete-able |
| `scaffold-*.mjs` | one-shot service generators (obsolete) | 🟢 |
| `check-queue.js`, `check-delayed.js`, `promote-jobs.js` | BullMQ inspection helpers (TLS Redis); `promote-jobs.js` **promotes all delayed jobs immediately** | 🟡 (dangerous if run casually) |
| `query_db.js`, `test-fb.js`, `download_and_probe.js` | ad-hoc debugging scripts (`test-fb.js` decrypts real tokens) | 🟢 |
| `cloudflared.exe`, `posts_debug.json`, `services/media-service/{test-ffmpeg4.js,test_out.mp4,verify_video.js}` | untracked scratch | 🟢 don't commit |
| `scripts/load-test.js` | k6 script targeting a nonexistent `/health` | 🟢 |
| `infra/docker-compose.yml` | Redis only | 🟢 |
| `k8s/deployments.yaml` | illustrative | 🟢 |
| `.github/workflows/ci.yml` | non-functional CI (branch `main`) | 🟢 |
| `supabase/config.toml`, `supabase/migrations/*` | DB definition; never edit existing migrations. Newest: `20260921000000_restore_read_policies` (applied), `20260922000000_notifications_read_and_realtime` (**owner must apply**) | 🔴 |

## Frontend `apps/web/src`
| Path | Purpose | Risk |
|---|---|---|
| `lib/supabase.ts` | browser Supabase client (`NEXT_PUBLIC_SUPABASE_*`) | 🟡 |
| `components/DashboardProvider.tsx` | global state, team bootstrap, Realtime | 🔴 (every page depends on it) |
| `components/DashboardShell.tsx` | sidebar/topbar; the notifications bell sits in the header (the old sidebar box is gone) | 🟡 |
| `components/NotificationBell.tsx` | header bell + dropdown (`NotificationList`): unread badge, "New" highlight, mark-all-read, older-than-7-days toggle; props-driven (render-tested) | 🟢 |
| `lib/notifications.ts` | relative time, unread count, badge text, recent/older split, `NOTIFICATION_LIMIT` / `NOTIFICATION_POLL_MS` (tested) | 🟢 |
| `app/layout.tsx`, `app/page.tsx` | root layout (default metadata), redirect to `/login` | 🟢 |
| `app/login/page.tsx` | signup/login | 🟡 |
| `app/dashboard/layout.tsx`, `dashboard/page.tsx` | provider wrapping; redirect to posts | 🟡 |
| `app/dashboard/posts/page.tsx` | timeline, timeline preview modal, delete / retry (~270 lines; the composer moved out in Calendar S2) | 🟡 |
| `components/post/PostComposer.tsx` | the compose form + submit flow (`variant` sidebar/modal, `initialScheduleAt`, `onSubmitted`, `onOptimisticChange`). Used by the Posts page and the calendar modal — the only place that creates posts from the UI | 🔴 (two entry points depend on it) |
| `components/post/PostModalShell.tsx` | generic dialog (overlay, Esc/backdrop/X close, scroll lock, focus restore, `isBusy` blocks closing); shared by the create and edit modals | 🟡 |
| `components/post/CreatePostModal.tsx` | the calendar's create modal = `PostModalShell` + `PostComposer` | 🟢 |
| `components/post/EditPostModal.tsx` | the calendar's edit modal (Step 3): caption edit + per-platform status + preview; talks to `PATCH /api/v1/posts/:id`. Render-tested in `EditPostModal.test.tsx` | 🟡 |
| `vitest.config.mts` | test config for `apps/web` (`@` alias, node env); tests are `src/**/*.test.{ts,tsx}` | 🟢 |
| `lib/calendarEvent.ts` | `toEvent()`: post → FullCalendar event (status colour, chips data, **whole post in `extendedProps`** for the edit modal) | 🟢 |
| `lib/calendarEdit.ts` | per-platform status list, edit rules (mirror the server's `editability.ts`, parity-tested), caption validation | 🟡 |
| `components/post/PlatformPreviewCard.tsx` | per-platform preview cards, `VideoPlayer`, reel-orientation warning | 🟡 |
| `lib/mediaFrame.ts` | what media looks like per platform (mirrors media-service crops); keep in sync with `services/media-service` | 🟡 |
| `lib/calendarStatus.ts`, `lib/calendarPrefill.ts` | calendar aggregate status / start time; click → schedule prefill (all with unit tests) | 🟢 |
| `app/dashboard/calendar/page.tsx` | FullCalendar: read view + click-to-create (Steps 1–2); Steps 3–4 (edit, drag) go here | 🟢 |
| `app/dashboard/accounts/page.tsx` | connect/disconnect, platform list #1 | 🟡 |
| `app/dashboard/settings/page.tsx` | invite + mock billing | 🟢 |
| `apps/web/AGENTS.md`, `CLAUDE.md` | warn about this Next.js version — read `node_modules/next/dist/docs/` first | 🟡 |
| `package.json` | includes `lightningcss` for Vercel and FullCalendar | 🟡 |

## Services (`services/<name>/src/index.ts`, built to tracked `dist/index.js`)
| Service | Risk | Notes |
|---|---|---|
| `account-service` (398 l) | 🔴 | OAuth + encrypt(); token format lives here |
| `post-service` (178 l) | 🟡 | cache keys; status writes |
| `scheduling-service` (81 l) | 🔴 | creates queue jobs; payload + jobId conventions |
| `worker` (113 l) | 🔴 | status machine, retries, notifications |
| `publishing-service` (789 l) | 🔴 | all adapters; `decrypt()` |
| `media-service` (~220 l + `videoFilter.ts`) | 🟡 | variant rules; `media_url` JSON contract; `videoFilter.ts` = which canvas each platform/content type gets (mirrored by `apps/web/src/lib/mediaFrame.ts` — change both) |
| `analytics-service` (417 l) | 🟡 | cron + per-platform sync; 3rd copy of decrypt() |
| `notification-service` (42 l) | 🟢 | leaf consumer |
| `team-service` (89 l) | 🟢 | leaf, but role semantics duplicated elsewhere |
| `*/dist/index.js` | 🔴 don't hand edit | compiled output, tracked |

## Shared `packages/shared/src`
| File | Purpose | Risk |
|---|---|---|
| `index.ts` | Redis connection, queue names/factories (`PUBLISH_QUEUE_NAME`, `NOTIFICATIONS_QUEUE_NAME`), re-exports | 🔴 |
| `cache.ts` | role cache (300 s TTL) | 🟡 |
| `ratelimit.ts` | 5 per 60 s sliding window | 🟡 |
| `upstash.ts` | optional Upstash client | 🟡 |

## Where to look for X
| Question | Look at |
|---|---|
| How does a job get published? | `scheduling-service` → `worker` → `publishing-service` (`POST /publish/:jobId`) |
| Where are platform rules? | `publishing-service` adapters + `media-service` variants |
| Where are limits/roles? | `account-service` (accounts), `post-service` (posts), `team-service`, `packages/shared/cache.ts` |
| Where are statuses set? | `post-service`, `scheduling-service`, `worker`, YouTube adapter |
| Where does the UI decide colours/badges? | `posts/page.tsx` timeline; `calendar/page.tsx` |
| What DB columns exist? | `supabase/migrations` **plus** the drift list in `DATABASE.md` |
