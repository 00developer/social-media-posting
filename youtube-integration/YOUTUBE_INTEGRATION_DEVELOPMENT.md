# YouTube Integration — Development Document
### SocialPush — Adding YouTube as a connected platform

**Context:** Facebook and Instagram are already connected and publishing successfully (Meta App ID/App Secret flow, already implemented in `/services/account-service` and `/services/publishing-service`). This document adds **YouTube** as the next platform, using the same overall pattern (Account Service for OAuth, Publishing Service adapter for `prepareMedia()` / `publish()` / `getStatus()`) — but YouTube has real differences from Meta's flow that are called out explicitly below so nothing gets silently assumed to work "the same way."

**How to use this:** Feed this document to Antigravity in the same project (it already has the codebase). It assumes the **Operating Protocol** and **Engineering Rules** from `ANTIGRAVITY_DEVELOPMENT_PROMPT.md` are still in effect (self-check after every step, fix what's broken, stop and wait for approval before the next step) — if that file isn't in context anymore, the condensed version is repeated in Section 5 below so this document works standalone too.

---

## 1. Prerequisites — Google Cloud Console Setup (do this before any code)

1. Go to **console.cloud.google.com** → create a new project (or reuse an existing one for SocialPush).
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **APIs & Services → OAuth consent screen** → configure it (app name, support email, scopes — add `.../auth/youtube.upload` and `.../auth/youtube.readonly`). While in **Testing** mode, only Google accounts you explicitly add as test users can authorize the app — add your own account to test with. Public rollout requires Google's app verification for this sensitive scope; not needed for development/testing.
4. **APIs & Services → Credentials → Create Credentials → OAuth Client ID** → type **Web application** → add an Authorized redirect URI matching your callback route (e.g. `https://yourapp.com/api/v1/account-service/youtube/callback`, or `http://localhost:PORT/...` for local dev).
5. Note down the **Client ID** and **Client Secret** — these are the YouTube equivalent of the Facebook App ID/App Secret you already have.

### Environment variables to add
```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=...
```
Add these to `.env.example` with a comment that they're backend-only, same as the existing Meta credentials.

---

## 2. Working Logic — What's Different About YouTube

Read this before writing the adapter. These are the real differences from the Facebook/Instagram flow you already built.

1. **OAuth token lifetime is different.** Google's `access_token` expires in ~1 hour (much shorter than Facebook's long-lived token). You must request `access_type=offline&prompt=consent` in the initial authorization URL to actually receive a `refresh_token` — without both parameters, Google may not return one, and you'd have no way to silently renew access later. The refresh token itself doesn't expire on a schedule (unlike Facebook's ~60-day token) — it stays valid until the user revokes access or it's unused for 6 months.

2. **Upload is not a single API call.** Facebook/Instagram publishing was closer to "send the content, get a post ID back." YouTube uses a **resumable upload protocol**:
   - Step A: `POST` a request with the video's metadata (title, description, tags, privacy status) to initiate an upload session → YouTube returns a session URI.
   - Step B: `PUT` the actual video bytes to that session URI (can be chunked for large files, and resumed if interrupted — this is the point of the protocol).
   - Step C: On success, YouTube returns the video's ID and initial status.
   This means `publish()` for YouTube is inherently a longer-running operation than for Facebook/Instagram, and needs to handle partial/interrupted uploads.

3. **"Published" isn't immediate.** After upload finishes, the video enters YouTube's own processing pipeline (`uploaded → processing → processed`, or `failed`/`rejected`). `getStatus()` must poll `videos.list?part=status,processingDetails&id=<videoId>` until it reaches a terminal state — a 200 response from the upload call does **not** mean the video is live or even valid yet.

4. **Media requirements differ.** Target aspect ratio for standard video is **16:9**; YouTube Shorts (if you support that later) is 9:16. Apply the same "generate the platform-correct variant from the untouched original" logic already used for Instagram/Facebook — just with YouTube's ratio and its own compression/format requirements (H.264/MP4 recommended) instead of Meta's.

5. **Privacy status must be explicit.** Every upload requires a `privacyStatus` field (`public`, `unlisted`, or `private`). There's no sensible default to silently assume — either let the user pick it in the Create Post UI, or hard-code `unlisted` for now and surface it as a visible setting before this ships broadly.

6. **API quota is a real constraint, not just a rate limit.** The default YouTube Data API quota is 10,000 units/day, and a single video upload costs **1,600 units** — so roughly 6 uploads/day per project by default before you'd need to request a quota increase from Google. This won't block early testing but will block real usage if not requested ahead of time — flag it now rather than discovering it in production.

---

## 3. Database Changes (Supabase migration)

- `social_accounts`: confirm `'youtube'` is a valid value in the `platform` check constraint (extend it if the constraint currently only lists `facebook`/`instagram`). No new columns strictly required, but if you want to show the connected channel's name in the UI, add nullable columns: `channel_id text`, `channel_title text`.

- `media_variants`: no schema change — a YouTube variant is just another row with `platform = 'youtube'`, same as existing Facebook/Instagram variant rows.

- **New table** `youtube_upload_sessions` — tracks in-progress resumable uploads so an interrupted upload can resume instead of restarting from zero:
```sql
create table youtube_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references posts(id),
  user_id uuid references auth.users(id),
  session_uri text not null,
  bytes_uploaded bigint default 0,
  status text check (status in ('in_progress','completed','failed')) default 'in_progress',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table youtube_upload_sessions enable row level security;

create policy "owner_access_only"
on youtube_upload_sessions for all
using (user_id = auth.uid());
```
(A worker using the service role key will bypass this RLS policy to act on behalf of the user — same pattern already used for `publish_jobs`, so no new pattern to learn here.)

---

## 4. Backend Implementation — Step by Step

Build these in order. Each step gets its own self-check + approval gate (Section 5) — do not merge steps.

### Step 1 — YouTube OAuth Connect (extends Account Service)
- Add a "Connect YouTube" flow to `/services/account-service`: build the Google authorization URL (with `access_type=offline&prompt=consent` and the two scopes from Section 1), handle the callback, exchange the code for `access_token` + `refresh_token`.
- Encrypt both tokens the same way the existing Facebook/Instagram tokens are encrypted, and store them in `social_accounts` with `platform = 'youtube'`.
- Implement a silent token-refresh helper (`refreshYouTubeToken()`) that uses the stored `refresh_token` to get a new `access_token` when the current one is expired or about to expire — call this before every YouTube API call rather than reacting to a 401.
- Frontend: add a "Connect YouTube" button next to the existing Facebook/Instagram connect buttons, wired to this flow.

### Step 2 — Media Variant Generation for YouTube (extends Media Service)
- Add YouTube's 16:9 ratio and format/compression rules to the existing variant-generation logic in `/services/media-service` (same function that already handles Instagram/Facebook ratios — extend it, don't fork a separate pipeline).
- Store the generated variant as a `media_variants` row with `platform = 'youtube'`, same as existing rows for other platforms.

### Step 3 — YouTube Adapter: `prepareMedia()` / `publish()` / `getStatus()`
- Implement the adapter interface in `/services/publishing-service`, matching the same interface shape already used for the Facebook/Instagram adapters so the worker doesn't need any platform-specific branching outside this file.
- `publish()` implements the 3-step resumable upload from Section 2 (initiate session with metadata → upload bytes → capture returned video ID), writing progress into `youtube_upload_sessions` as it goes so a retry can resume rather than restart.
- `getStatus()` polls YouTube's processing status and maps it to the existing post state machine (`Processing` while YouTube is still processing, `Published` once terminal-success, `Failed` on terminal-failure) — reuse the existing state machine, don't introduce a YouTube-only status enum.
- Wire this adapter into the existing per-platform worker pattern so a YouTube job runs independently of Facebook/Instagram jobs for the same post (same fan-out logic already in place).

### Step 4 (optional, do after Steps 1–3 are confirmed working) — YouTube Analytics
- Extend the existing Analytics Service to pull view/like/comment counts for published YouTube videos via the YouTube Analytics API, on the same periodic-pull pattern already used for other platforms.

---

## 5. Operating Protocol (condensed — full version in `ANTIGRAVITY_DEVELOPMENT_PROMPT.md`)

For **each step in Section 4**:
1. **Build** only that step's scope.
2. **Self-check:** run lint + type-check + tests; boot the service and manually test the actual flow (connect a real test YouTube account in Step 1; actually upload and confirm a real video appears on YouTube in Steps 2–3); confirm the RLS policy on `youtube_upload_sessions` actually blocks a second test user from seeing the first user's session.
3. **Fix** anything broken before calling the step done.
4. **Report**, using the same format as the main prompt:
```
## YouTube Step [N] — [Step Name] — Complete

### What was built
### Self-check performed (lint / type-check / tests / RLS test / manual smoke test)
### Issues found & fixed
### Known limitations
### Waiting for your approval to start Step [N+1]
```
5. **STOP.** Do not start the next step until you get an explicit go-ahead, exactly as the main protocol requires.

---

## 6. Rules Specific to This Addition

- Never expose `GOOGLE_CLIENT_SECRET` or the Supabase service role key to the frontend — same rule as every other credential in this project.
- Encrypt the YouTube `access_token` and `refresh_token` at the application level before storing, exactly like the existing Facebook/Instagram tokens — no exceptions for "it's just a short-lived token."
- Keep the adapter interface (`prepareMedia`, `publish`, `getStatus`) identical in shape to the existing adapters — the whole point of the pattern is that the worker and Publishing Service don't need to know YouTube exists as a special case.
- Don't invent a YouTube-only post status — map YouTube's processing states onto the existing `Draft / Scheduled / Processing / Publishing / Published / Failed` state machine.

---

*End of YouTube Integration Development Document.*
