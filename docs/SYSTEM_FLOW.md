# System Flows (as implemented)

## 1. Sign up / login / team bootstrap
1. `/login` calls `supabase.auth.signUp` or `signInWithPassword` (browser → Supabase). On success → `/dashboard`.
2. `DashboardProvider` gets the session (else redirects to `/login`), then `fetchUserTeams`: reads `team_members` joined with `teams`.
3. If the user has **no** team, the *browser* inserts `teams` ("My Personal Team") then `team_members` (role `owner`). (Needs INSERT RLS policies not present in migrations — verify on the live DB.)
4. First team becomes `activeTeam`; `fetchTeamData` loads accounts, posts(+publish_jobs), notifications, analytics. A Realtime channel refreshes on notification INSERT / job & post UPDATE.

## 2. Connect a social account
1. Accounts page opens a blank popup, then `GET :3001/api/v1/auth/<platform>/url?userId&teamId`.
2. account-service checks role (cache → DB; viewers rejected) and free-plan limit (10 accounts), builds the provider URL, stores `state → {codeVerifier,userId,teamId}` in an **in-memory Map**, returns `{url}`.
3. Popup is redirected to the provider; provider redirects to `API_BASE_URL/api/v1/auth/<platform>/callback?code&state`.
4. Callback exchanges the code (Meta/Threads also exchange for a long-lived token), encrypts tokens, inserts `social_accounts` (`user_id`, `team_id`, `platform`, `access_token_encrypted`, `refresh_token_encrypted`), replies with `window.close()` HTML. The parent polls `popup.closed` every 500 ms and calls `fetchTeamData()`.
5. Pinterest additionally inserts columns `provider_account_id/handle/status` and imports boards into `pinterest_boards` (creating a "SocialPush" board if none).
6. TikTok: "URL" is the callback itself with a fake code — mock tokens. LinkedIn: real authorize URL but the callback falls into the **mock-token branch** (see INTEGRATIONS.md).

## 3. Compose → media → post → schedule/publish  (`posts/page.tsx: handleCreatePost`)
1. If a file is attached: `POST :3006/api/v1/media/upload` (multipart: `file, userId, platforms, contentType`). media-service builds one variant per selected platform and returns `mediaUrls: {platform: publicUrl}`.
   - Image → sharp resize per platform (IG 1080×1350 cover, X 1200×675, YT 1920×1080, Pinterest 1000×1500, Threads ≤1440 wide, others plain JPEG). Video → ffmpeg H.264/AAC, platform duration checks for reels, Threads ≤300 s.
2. `POST :3002/api/v1/posts` with `{userId, teamId, content, mediaUrl: JSON.stringify(mediaUrls)}` → `posts` row, `status='draft'`; feed cache `feed:<team>` deleted.
3. Action:
   - **Save Draft** → stop.
   - **Publish Now** → `POST :3004/api/v1/schedules` with `scheduledAt = now`.
   - **Schedule** → same with the chosen `datetime-local`.
4. scheduling-service: authorizes via `team_members` (non-viewer), validates date (≥ now−5 min), then **per platform**: insert `schedules`, insert `publish_jobs(status='scheduled', content_type)`, `publishQueue.add('publish-post', {jobId,postId,userId,platform}, {delay, jobId: publish_jobs.id})`. Finally `posts.status='scheduled'`.
5. UI clears the form and re-fetches. The timeline shows an optimistic "uploading" card while steps 1–4 run.

## 4. Worker → publishing (the critical path)
1. Worker receives the job → `publish_jobs.status='processing'` → loads post text for the notification excerpt → `POST http://localhost:3003/api/v1/publish/<jobId>`.
2. publishing-service: load job → Upstash rate limit `publish_<userId>` 5/min (429 if exceeded) → load post → load account by **(post.user_id, job.platform)** `.single()` → decrypt token → `adapter.publish(post, account, token, job.content_type, job)`.
3. Adapter calls the platform API (see INTEGRATIONS.md) and throws on any error. Errors containing `rate limit reached` map to HTTP 429; everything else HTTP 500.
4. Worker outcomes:
   - `429` → `job.moveToDelayed(now+1h)`, DB status back to `scheduled`, `return` (no `DelayedError` thrown — see KNOWN_ISSUES).
   - OK → `publish_jobs.completed`; if **every** job of the post is `completed` → `posts.published`; enqueue success notification.
   - Error → read `retry_count`, +1. If `>3`: job `failed` + `posts.failed` + failure notification. Else: job `failed` with message and **rethrow** (BullMQ would retry only if `attempts>1`, which is never set).
5. notification-service inserts a `notifications` row (Realtime pushes it to the browser) and logs a mock email.

## 5. "Publish Now" / "Retry Publish" on an existing card (`handlePublish`)
`window.prompt` asks for a comma-separated platform list, then calls `POST :3004/schedules` with `scheduledAt=now` and **no `contentType`** (defaults to `post`). This creates **new** `schedules` and `publish_jobs` rows; old failed jobs remain.

## 6. Calendar (read-only)
`calendar/page.tsx` → on `datesSet`, `GET :3002/api/v1/posts?userId&teamId&from&to` → post-service does an inner join on `schedules` for the range and returns posts with `publish_jobs`. Each post = one event at `schedules[0].scheduled_at`, colour by aggregate status (failed red, published green, processing amber, else blue). No click/drag handlers exist yet.

## 7. Analytics
- **Producers:** nothing in the repo calls `POST :3008/analytics/event` (the endpoint exists for future/real-time use).
- **Cron (every 5 min via BullMQ repeatable job in analytics-service):**
  1. Drain `analytics:*` Redis counters → upsert into `analytics` per (post, platform).
  2. YouTube: for `youtube_upload_sessions` with `video_id`, call Data API `videos?part=statistics` (refresh token via account-service on 401). Mapping: views→views, likes→likes, **comments→shares**.
  3. Pinterest: for pins in `pinterest_published_pins` (<90 days), call pin analytics. Mapping: IMPRESSION→views, SAVE→likes, OUTBOUND_CLICK→shares.
  4. Threads: for every Threads account, list `me/threads`, match each to a post by **identical text** (`posts.content`), fetch insights. Mapping: views, likes, replies+reposts+quotes→shares.
  5. Facebook, Instagram, Twitter, LinkedIn, TikTok analytics are **not implemented**.
- **Consumer:** frontend reads `analytics` filtered by `team_id` — but the sync code never sets `team_id` on rows it inserts (KNOWN_ISSUES).

## 8. Team management
- Invite: `POST :3009/teams/:id/invite {email, role, inviterId}` → inviter must be owner/admin → finds an *existing* auth user by email (`auth.admin.listUsers()`, first page only) → inserts `team_members`. No email is sent; unknown emails get 404.
- Billing: owner-only plan flip `free`/`pro` (mock, no payment provider).
- Removal of members / role change / rename team: not implemented anywhere.
