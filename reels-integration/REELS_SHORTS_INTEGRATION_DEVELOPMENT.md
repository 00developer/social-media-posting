# Reels / Shorts Integration — Development Document
### SocialPush — Adding Reel/Short publishing to Instagram, Facebook, and YouTube

**Context:** Instagram, Facebook, and YouTube are already connected and publishing regular feed content (images/videos). This document adds **Reels/Shorts as a new content type** on top of all three, built in this order — **YouTube first, then Instagram, then Facebook** — from least implementation effort to most, as confirmed.

**How to use this:** Feed this document to Antigravity in the same project (it already has the codebase). It assumes the **Operating Protocol** and **Engineering Rules** from `ANTIGRAVITY_DEVELOPMENT_PROMPT.md` are still in effect — the condensed version is repeated in Section 5 so this document also works standalone.

---

## 1. Prerequisites

No new developer app registration is needed — this reuses the existing Facebook, Instagram, and Google credentials already connected. One thing to explicitly verify rather than assume:

- The connected Facebook Page's access token has `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, and a `CREATE_CONTENT` task on the Page. Reels publishing is technically a separate product surface from feed publishing on Meta's side, and while it normally rides on the same permissions already granted, a permission-shaped error here can look unrelated at first glance — verify this before assuming Step 3 is broken for some other reason.

---

## 2. Working Logic — Content Type as a First-Class Concept

The core addition here isn't really "three new API integrations" — it's introducing **content type (post vs. reel/short)** as a new dimension alongside platform, since one post can now target the same platform in two different shapes with different media requirements and, for Facebook, an entirely different publishing mechanism.

1. **Content type must be an explicit user choice, not inferred.** When composing a post and selecting Instagram/Facebook/YouTube as a target, the user picks "Post" or "Reel/Short" for that platform. Media requirements and API mechanics differ by content type, not just by platform — don't guess this from file dimensions after the fact.

2. **Media variant generation branches by (platform, content type):**
   | Platform | Post variant (existing) | Reel/Short variant (new) |
   |---|---|---|
   | Instagram | 4:5 | 9:16, ≤90 seconds |
   | Facebook | 1.91:1 | 9:16, 1080×1920 (recommended), 3–90 seconds |
   | YouTube | 16:9 | 9:16 or 1:1, ≤180 seconds (3 minutes) |

3. **Adapter behavior differs by platform, not just by content type — this is the part that trips people up:**
   - **YouTube:** No branching needed at all. The same `publish()` call already built handles this — YouTube automatically classifies a video as a Short purely from the uploaded file's own properties (vertical/square aspect ratio + duration ≤ 3 minutes). Feed it the new Short variant through the existing adapter, nothing else changes.
   - **Instagram:** Same endpoint (`POST /{ig-user-id}/media`), different parameter — `media_type=REELS` (with `video_url`) instead of whatever is used for the existing image/video post flow. A small branch inside the existing `publish()`, not a new method.
   - **Facebook:** A **genuinely separate publishing mechanism** — reels do not go through the existing feed-post endpoint at all. They use a distinct 3-phase flow against `/{page-id}/video_reels` (start → upload → finish). This needs its own method internally, even though the adapter's external interface (`prepareMedia`/`publish`/`getStatus`) stays the same shape the worker already expects.

4. **Facebook Reels have their own rate limit: 30 API-published reels per 24 hours, per Page** — separate from Facebook's general post limits. This must be tracked and respected proactively (see Step 3), not discovered via a rejected API call.

5. **Reuse the existing state machine.** `Draft → Scheduled → Processing → Publishing → Published/Failed` doesn't need new states for reels — content type is additional metadata on the same job, not a new pipeline.

6. **Decide the over-length behavior once, apply it everywhere.** If a user selects "Reel/Short" for a platform but their uploaded video exceeds that platform's duration cap, the system needs one consistent rule — reject clearly and ask the user to trim (recommended for a first version, simplest to reason about) or auto-trim to the limit (a later enhancement). Don't let three different platforms silently handle this three different ways.

---

## 3. Database Changes (Supabase migration)

- Add a `content_type` column (check constraint: `'post'`, `'reel'`) to wherever per-platform post targeting already lives (e.g. `publish_jobs` or the equivalent existing table), default `'post'`.
- `media_variants`: add a `content_type` column too (or fold it into an existing compound key with `platform`), so a query can fetch "the reel variant for Instagram" distinctly from "the post variant for Instagram" — even where the raw aspect ratio looks similar across platforms, keep them as separate rows rather than trying to share one file across platforms with different duration caps.
- No new tables required — this is additive metadata on existing structures, not a new subsystem.

---

## 4. Backend Implementation — Step by Step (in the confirmed order: YouTube → Instagram → Facebook)

### Step 1 — YouTube Shorts (extends the existing YouTube adapter — no new endpoint)
1. Wire the `content_type` choice into the Create Post UI and through to the job record for YouTube targets.
2. In Media Service, add a Short variant generator: 9:16 (or 1:1), duration capped/validated at ≤180 seconds, applying the reject-or-trim decision from Working Logic point 6.
3. Feed this variant through the **existing, unmodified** YouTube `publish()`/`prepareMedia()`/`getStatus()` — no adapter code changes needed, this is the whole point of YouTube's automatic classification.
4. Optional: append "#Shorts" to the description — some API uploads land in a classification gray zone without it, and it costs nothing to include.

**Definition of done:** a real Short (9:16, under 3 minutes) uploaded through the existing YouTube adapter appears in the channel's Shorts shelf — verified directly on YouTube, not just a "published" status in the dashboard.

### Step 2 — Instagram Reels (extends the existing Instagram adapter — same endpoint, new parameter)
1. In Media Service, add a Reel variant generator: 9:16, duration capped/validated at ≤90 seconds.
2. In the existing Instagram `publish()`, branch on `content_type`: when `'reel'`, create the media container with `media_type=REELS` and `video_url` instead of the parameter(s) used for the current post flow. Support an optional `share_to_feed` flag (recommend defaulting to `true` so it also appears in the main feed grid, matching most users' mental model of "posting").
3. `getStatus()` should need no changes — Reels use the same container status/`video_status` fields already being polled for existing video posts.

**Definition of done:** a real reel published through this flow appears in the connected account's Reels tab — verified directly on Instagram, and querying the published media's `media_product_type` field (not `media_type`) confirms `REEL`.

### Step 3 — Facebook Reels (new publish path — genuinely separate flow)
1. Verify the prerequisites from Section 1 for the connected Page.
2. In Media Service, add a Reel variant generator: 9:16, 1080×1920 recommended (540×960 minimum), 3–90 second duration, 24–60fps.
3. In `/services/publishing-service`, implement a distinct `publishFacebookReel()` method (not a branch inside the existing feed-post call — the shape is genuinely different) implementing the 3-phase flow:
   - **Start:** `POST /{page-id}/video_reels` with `upload_phase=start` → returns `video_id` + `upload_url`.
   - **Transfer:** upload the video bytes to the returned `upload_url` (on `rupload.facebook.com`).
   - **Finish:** `POST /{page-id}/video_reels` with `upload_phase=finish`, `video_id`, description, `video_state=PUBLISHED`.
4. Keep the adapter's external interface consistent: the worker still just calls `publish()` on the Facebook adapter — internally, `publish()` should dispatch to either the existing feed-post flow or this new reel flow based on the job's `content_type`, so nothing outside the adapter needs to know two different mechanisms exist underneath.
5. **Enforce the 30-reels/24h Page limit proactively:** before dispatching a Facebook Reel job, count how many Facebook reels have published successfully for that Page in the last 24 hours; if at the limit, don't call the API — hold the job for a delayed retry with a clear status, rather than letting Facebook's API reject it opaquely.

**Definition of done:** a real reel published through this flow appears on the connected Facebook Page's Reels — verified directly on Facebook; a deliberately-forced 31st reel within a 24-hour window is caught by the internal rate check *before* hitting Facebook's API and is handled gracefully (delayed/queued with a clear status), not crashed or silently dropped.

---

## 5. Operating Protocol (condensed — full version in `ANTIGRAVITY_DEVELOPMENT_PROMPT.md`)

For **each step in Section 4**:
1. **Build** only that step's scope.
2. **Self-check:** lint + type-check + tests; boot the service and actually publish a real reel/short with a real test account for that platform, and confirm it appears correctly (right tab/shelf, right classification) by checking the platform directly — not just a "success" response.
3. **Fix** anything broken before calling the step done.
4. **Report**, using the same format as the main prompt:
```
## Reels/Shorts Step [N] — [Platform] — Complete

### What was built
### Self-check performed (lint / type-check / tests / manual smoke test on real platform)
### Issues found & fixed
### Known limitations
### Waiting for your approval to start Step [N+1]
```
5. **STOP.** Do not start the next step until you get an explicit go-ahead.

---

## 6. Rules Specific to This Addition

- `content_type` is mandatory metadata on every reel/short job — never inferred from file properties alone, always the user's explicit choice.
- Facebook reels use a genuinely separate internal method, not a parameter branch — because the call shape actually differs — but the adapter's external interface (`prepareMedia`/`publish`/`getStatus`) must stay identical in shape to every other adapter already built.
- Track and respect Facebook's 30-reels/24h Page limit proactively; never rely on catching the API's rejection after the fact.
- Reuse the existing state machine and worker fan-out logic unchanged — content type is additional job metadata, not a new pipeline or a new set of statuses.
- Apply the same reject-or-trim rule consistently across all three platforms for over-length uploads (Working Logic point 6) — don't let each platform's adapter invent its own behavior.

---

*End of Reels/Shorts Integration Development Document.*
