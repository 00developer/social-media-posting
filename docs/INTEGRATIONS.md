# Integrations

Status legend: ✅ implemented in code · ⚠ implemented but with a notable gap · ❌ mock/not implemented. "Verified working" is **not** claimed — the audit was read-only. The previous agent's reports say Facebook, Instagram, YouTube, LinkedIn, Pinterest were "connected and publishing successfully", but the code shows LinkedIn cannot have connected for real (see below).

| Platform | Connect (OAuth) | Publish | Analytics | Token refresh | Overall |
|---|---|---|---|---|---|
| Twitter/X | ✅ OAuth2 PKCE (`TWITTER_CLIENT_ID/SECRET`, scopes tweet.read/write, users.read, offline.access) | ⚠ text only | ❌ | ❌ (refresh token stored, unused) | Partial |
| Facebook (Pages) | ✅ FB Login v18.0 + long-lived token | ✅ text, photo, Reel | ❌ | ❌ | Working path; first page only |
| Instagram | ✅ same FB Login | ✅ image, Reel (container + poll + publish) | ❌ | ❌ | Working path; image/reel only |
| YouTube | ✅ Google OAuth, offline | ✅ resumable upload, unlisted, Shorts tag | ✅ views/likes/comments | ✅ via account-service | Most complete |
| LinkedIn | ⚠ authorize URL real; **callback stores mock tokens** | ⚠ adapter real (REST 202401) but needs a real token + `provider_account_id` | ❌ | ❌ | Not usable end-to-end |
| Pinterest | ✅ code exchange, profile, boards import/create | ⚠ image pin, video pin | ✅ impressions/saves/clicks | ❌ (refresh token stored, unused) | Working path; likely media URL bug |
| Threads | ✅ code → long-lived token (`THREADS_CLIENT_ID/SECRET`) | ✅ TEXT/IMAGE/VIDEO, quota check, container polling | ⚠ implemented, scope missing | ❌ | Code-complete but **untested** |
| TikTok | ❌ fake code redirect, mock tokens | ❌ adapter only logs | ❌ | ❌ | Stub |

## Details & quirks per platform

### Meta (Facebook / Instagram) — `FACEBOOK_APP_ID/SECRET`
- Scopes requested: `pages_show_list, instagram_basic, instagram_content_publish, pages_read_engagement, pages_manage_posts, publish_video`. Graph API version pinned to **v18.0** everywhere (old; bump requires re-testing).
- One `social_accounts` row per platform holds the **user** token; page tokens are re-fetched at publish time via `/me/accounts` with a `debug_token` fallback (`getFacebookPages`).
- Facebook and Instagram are connected separately but use the same login and token — connecting both creates two independent rows.
- Non-reel video posts: Facebook posts to `/photos` and Instagram sets `image_url` even if the URL is a video → those combinations will fail (video is only handled properly under `contentType='reel'`).
- Meta requires HTTPS redirect URIs → the developer used a **cloudflared tunnel** (`API_BASE_URL`).
- Meta long-lived user tokens last ~60 days; there is no refresh job.

### Threads — `THREADS_CLIENT_ID/SECRET` (separate Threads app credentials, wired in code)
- Authorize: `https://threads.net/oauth/authorize`, scopes `threads_basic,threads_content_publish` only.
- Token: short-lived at `graph.threads.net/oauth/access_token`, exchanged with `th_exchange_token` (long-lived, 60 days). No refresh (`th_refresh_token`) implemented.
- Publish uses `graph.threads.net/v1.0/me/threads` → poll status → `me/threads_publish`.
- Analytics calls `/insights` which needs `threads_manage_insights` — **not requested** in the OAuth scope, so insights will fail permission checks until added (and App Review is needed for real users; works for own test users only).
- Matching Threads posts back to `posts` by equal text is fragile (edited text, duplicates).
- `THREADS_REDIRECT_URI` from the design doc is not used; the redirect is `<API_BASE_URL>/api/v1/auth/threads/callback`.
- The 500 limit is enforced in **bytes**; Threads' documented limit is 500 characters, so multi-byte text (emoji, Hindi, etc.) may be rejected early. The design doc asked for a visible counter in the UI — not built.

### YouTube — `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`
Scopes `youtube.upload` + `youtube.readonly`. The `channel_id/channel_title` columns are never populated. Whole video is downloaded into memory before upload. `youtube_upload_sessions` supports resuming an existing `in_progress` session URI, but the resume path re-PUTs the full file rather than querying the uploaded range.

### LinkedIn — `LINKEDIN_CLIENT_ID/SECRET/REDIRECT_URI` (none currently in `.env`)
The callback has no LinkedIn branch, so it inserts `mock_linkedin_access_token`. The adapter builds `urn:li:person:<provider_account_id>` from a column no code sets. The UI expiry warning depends on `refresh_token_expires_at`, which nothing sets for LinkedIn. LinkedIn scope requested: `openid profile email w_member_social` (no organization scopes although the adapter supports org posting).

### Pinterest — `PINTEREST_CLIENT_ID/SECRET/REDIRECT_URI` (none currently in `.env`)
Basic-auth code exchange, imports boards, creates a "SocialPush" board if none exist. Video pins need a cover image — currently a hardcoded `via.placeholder.com` URL. Image/video URL taken from `post.media_variants?.pinterest || post.media_url`; because `media_variants` does not exist and `media_url` is a JSON string, this likely passes JSON as the URL. Refresh token expiry timestamp is set to now+60 days.

### Twitter/X — `TWITTER_CLIENT_ID/SECRET` (not in `.env`; code falls back to `'mock'`)
`loginWithOAuth2` is real. Adapter posts text only ("kept simple for text MVP").

### TikTok
Entirely simulated (connect and publish).

### Supabase Storage
Public bucket `post_media`; URLs handed directly to Meta/Threads/Pinterest, which fetch them — they must be publicly reachable (they are).

### Redis
- BullMQ requires a real Redis protocol endpoint (`REDIS_URL`). Upstash REST (`UPSTASH_*`) is used only for role cache, feed cache, rate limiting, analytics counters when set. Without Upstash env vars the same features silently degrade: no role cache, no rate limiting; post-service falls back to ioredis for feed cache; analytics falls back to ioredis.

## Adding a new platform — checklist
1. Migration: extend `social_accounts_platform_check` (keep list cumulative).
2. account-service: URL branch + callback branch (+ env vars).
3. publishing-service: adapter class + `adapters` entry.
4. media-service: variant case in image branch (and video rules if any).
5. Frontend: platform arrays in `accounts/page.tsx` **and** `posts/page.tsx`; optional preview card in `PlatformPreviewCard`; aspect ratio in `getAspectRatioClass`.
6. analytics-service: sync block if stats are supported.
7. Update `.env.example` (currently stale: only Supabase, Redis, Google).
