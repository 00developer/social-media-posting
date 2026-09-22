# dev-scripts — small helpers used while building Calendar Steps 1–3

Plain Node scripts, run from anywhere: `node docs/dev-scripts/<name>.js`. They find the repo root from their own location, load the root `.env` themselves and never contain a secret. They are **not** part of the app.

| Script | Reads / writes | What it does |
|---|---|---|
| `queue.js` | read-only | Prints `publish-queue` counts and every delayed / waiting / active / failed BullMQ job (id, run time, payload). |
| `snap.js <postId> [outFile]` | read-only | Snapshot of one post: its `posts` / `schedules` / `publish_jobs` rows **and** its BullMQ jobs, plus table totals. Take one before and one after an action and compare (this is how the Step 3 "nothing but the caption changed" invariants are proven). |
| `compare-snapshots.js <before> <after> [expectedContentJson]` | read-only | Compares two `snap.js` files and checks the Step 3 invariants: same post id; only `content` / `updated_at` changed; same schedules, publish_jobs and BullMQ jobs (id, state, delay, run time); totals unchanged; optional exact-content check. Exit code 0 = all hold. |
| `edit-caption.js <postId> <contentJson>` | **writes to Supabase** (via post-service) | Sends the exact request the calendar edit modal sends (`PATCH /api/v1/posts/:id`). Needs post-service on `:3002`. Used for the change-and-restore test on the real test post. |
| `requeue.js [--dry]` | **writes to Redis** | Re-adds every `publish_jobs` row that is still `scheduled` in Supabase but missing from BullMQ, exactly like `services/scheduling-service` does (`add('publish-post', {jobId, postId, userId, platform}, {delay, jobId: publish_jobs.id})`). Idempotent (skips jobs already queued). Use it after the Redis database was replaced or flushed. **Run `--dry` first**: the jobs it adds publish to real accounts. |
| `verify_redis.js` | read-only (+ one 30 s probe key) | Checks the Redis in `.env`: TLS `PING`, Upstash REST `/ping` + set/get, BullMQ counts, and how many `scheduled` jobs in Supabase are not queued. |
| `media-e2e.js` | **writes to Storage** (scratch only) | Generates 3 sample clips (landscape / vertical / square) and uploads each as reel and as post to the running media-service (`:3006`) for 6 platforms, measures every output with ffprobe (reel → 1080×1920 except Threads, standard → platform canvas, Threads natural) and checks the landscape reel is padded, not stretched. Deletes everything it uploaded (`media-e2e-*` folder) at the end. Needs media-service running. |
| `realtime-check.js [userId]` | **writes to Supabase** (one scratch row, deleted at once) | Subscribes with the service role and inserts one scratch notification for a user who is **not** the dashboard owner, waits up to 30 s for the Realtime INSERT event, then deletes the row. FAIL = `public.notifications` is not in the `supabase_realtime` publication. Re-run it after applying the notifications migration. |
| `s31_tests.js` | **writes to Supabase** (scratch only) | 37 real-HTTP checks for `PATCH /api/v1/posts/:id` against the running post-service (`:3002`). Creates a scratch team, posts and job rows, and deletes the team (cascade) at the end. Never touches the real post except for rejected cross-team calls. |

## Things to know before reusing them
- `s31_tests.js` has this database's ids hard-coded at the top (`OWNER`, `OTHER`, `REAL_TEAM`, `REAL_POST`). Change them for another database.
- They need the services they talk to: `s31_tests.js` needs post-service on `:3002`; the queue scripts only need Redis.
- Never run the repo-root `promote-jobs.js` — it promotes **every** delayed job immediately, i.e. it publishes all scheduled posts now.
- Times are printed in IST for readability; stored values are UTC.
| `retry-e2e.js` | **writes to Supabase + Redis** (scratch data only, cleaned up) | Full failure/retry lifecycle against the running services: permanent vs transient failure, 3 attempts with 1 min / 2 min backoff (promotes only its own jobs), failure notification, the retry endpoint guards (403/404/400/409), retry of selected/all failed platforms. ~3 min, expects 42 PASS. Needs worker + notification-service running. |
