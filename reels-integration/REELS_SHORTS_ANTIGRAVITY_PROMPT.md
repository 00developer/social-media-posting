# SocialPush — Reels / Shorts Integration — AI Development Agent Prompt
### For use with Antigravity (Gemini 3.1 Pro High)

**How to use this:** Paste this entire document as your instruction to the agent, in the **same Antigravity project** where SocialPush already exists (Instagram, Facebook, and YouTube are already connected and publishing regular posts/videos). Keep `REELS_SHORTS_INTEGRATION_DEVELOPMENT.md` in the same folder as extra reference — this file is the direct, step-gated build instruction the agent should actually follow.

---

## Role

You are an autonomous senior full-stack engineer working on an **existing, already-partially-built codebase** — SocialPush, a multi-platform social media publishing SaaS. Instagram, Facebook, and YouTube are already fully connected and publishing regular feed content. Your job now is to add **Reels/Shorts as a new content type** across all three, by extending the existing Media Service and Publishing Service adapters — not by rebuilding them. You must follow the **Operating Protocol** in Section 3 exactly, on every single step, with zero exceptions — this protocol matters more than speed.

---

## 1. Context — What Already Exists (do not rebuild any of this)

- **Publishing Service** already implements the adapter pattern for Instagram, Facebook, and YouTube — `prepareMedia()`, `publish()`, `getStatus()`, same shape across all three, called by the worker without platform-specific branching outside the adapter files.
- **Media Service** already generates platform-specific *post* variants (Instagram 4:5, Facebook 1.91:1, YouTube 16:9) from a single untouched original.
- The **post state machine**, **per-platform fan-out job logic**, and **worker/queue system** (Redis + BullMQ) are already built and working for regular posts across all three platforms.
- **Nothing in the codebase currently distinguishes "post" from "reel/short" as a content type.** That distinction is the entire point of this task.

**Your job is to add content-type awareness to the existing system — never to fork a parallel publishing pipeline.** Where a platform lets you reuse the existing mechanism (YouTube, Instagram), extend it. Where a platform genuinely requires a different mechanism (Facebook), isolate that difference internally while keeping the adapter's external interface unchanged.

---

## 2. Prerequisites

No new developer app registration or new credentials are needed. Before Step 3 (Facebook), explicitly verify — don't assume — that the connected Facebook Page's access token has `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, and a `CREATE_CONTENT` task. A missing permission here produces an error that can look unrelated to permissions at first glance.

---

## 3. Operating Protocol — CRITICAL, follow exactly every step, no exceptions

For **every step** listed in Section 7, follow this exact loop. Do not shortcut it, do not combine steps, do not skip Step 5.

### Step 1 of the loop — Build
Implement only what is in scope for the current step's numbered instructions in Section 7. Do not implement a later step early. Do not skip part of the current step.

### Step 2 of the loop — Self-check (mandatory before reporting anything as done)
- Run the linter and the type-checker on all changed/new code.
- Run the full automated test suite.
- Boot the affected service(s) and **actually publish a real reel/short to a real test account** for that platform — not a mock, not an assumption. Then check the actual platform (Instagram Reels tab, Facebook Page Reels, YouTube Shorts shelf) to confirm it shows up correctly classified, not just that the API call returned success.
- For Step 3 (Facebook) specifically: confirm the 30-reels/24h internal rate check actually blocks a 31st attempt in your test, rather than assuming the count logic is correct.
- Actively search for: broken imports, unhandled promise rejections/exceptions, missing environment variables, failing API calls, console/runtime errors, type errors, dead code, any case where a reel/short silently fell back to the existing post-publishing path instead of the new one, and anything that duplicates logic instead of extending the existing adapters.

### Step 3 of the loop — Fix
Fix every issue found in Step 2 before moving on. Never report a step as complete while a test is failing, the app fails to boot, or a published reel/short doesn't actually show up correctly on the real platform. If you find yourself fixing the same issue more than 3 times without success, **stop and report the blocker** instead of continuing to patch blindly.

### Step 4 of the loop — Report
Produce a completion report using exactly this format:

```
## Reels/Shorts Step [N] — [Platform] — Complete

### What was built
- (bullet list of what was actually implemented, step by step)

### Self-check performed
- Lint: pass / fail
- Type-check: pass / fail
- Tests: X passed / Y failed
- Manual smoke test: (what you actually published to the real platform, and confirmation it appeared correctly classified)
- (Facebook step only) Rate-limit check test: pass / fail

### Issues found & fixed
- (bullet list, or "None found")

### Known limitations / intentionally deferred
- (bullet list, or "None")

### Waiting for your approval to start Step [N+1] — [Next Platform]
```

### Step 5 of the loop — STOP and wait for explicit approval
Do not write, generate, or scaffold **any** code for the next step. Wait for the user to explicitly say something like "go ahead," "approved," "start step [N+1]," or "yes continue."

- If the user gives feedback or asks for changes instead, apply them, repeat Step 2 (self-check) and Step 3 (fix), and produce an **updated** completion report for the same step — still without starting the next step.
- If the user asks a question, answer it in place without starting new code.

**You must never:**
- Auto-start the next step right after finishing the current one.
- Mark a step complete while a test fails, the build is broken, or a real publish attempt didn't actually appear correctly on the platform.
- Silently drop a numbered instruction and still call the step "done."
- Add a Facebook reel branch inside the existing feed-post method — it must be its own method internally (Section 5, point 3), even though the adapter's external interface stays the same shape.
- Skip the Facebook 30-reels/24h proactive rate check and rely on the API's own rejection instead.
- Do the steps in Section 7 out of order (YouTube → Instagram → Facebook, as confirmed).

---

## 4. Engineering Rules for This Addition

- `content_type` (`'post'` / `'reel'`) is mandatory, explicit metadata on every job — never inferred from file dimensions or duration after the fact.
- Keep every adapter's external interface (`prepareMedia`, `publish`, `getStatus`) identical in shape to what the worker already expects — internal implementation may branch (Instagram) or dispatch to a separate internal method (Facebook), but the outside-facing contract does not change.
- Reuse the existing post state machine — do not add new status values for reels/shorts.
- Apply the same reject-or-trim rule for over-length uploads consistently across all three platforms (see Section 5, point 6) — don't let three adapters invent three different behaviors.
- All database changes are versioned Supabase CLI migrations, consistent with the existing schema.

---

## 5. Working Logic — What's Actually Different Here (read before Step 1)

1. **Content type is a new, explicit dimension.** The user picks "Post" or "Reel/Short" per platform when composing — this cannot be inferred from the uploaded file, because the same original media might be intended as either depending on the user's choice.

2. **Variant requirements per (platform, content type):**
   | Platform | Post (existing) | Reel/Short (new) |
   |---|---|---|
   | Instagram | 4:5 | 9:16, ≤90s |
   | Facebook | 1.91:1 | 9:16, 1080×1920 rec., 3–90s |
   | YouTube | 16:9 | 9:16 or 1:1, ≤180s |

3. **The three adapters need three different levels of change — this is the crux of the task:**
   - **YouTube: zero adapter changes.** YouTube auto-classifies a Short purely from the uploaded file's aspect ratio (vertical/square) and duration (≤3 min). Feed the new Short variant through the unmodified existing `publish()` call.
   - **Instagram: a small branch in the existing `publish()`.** Same endpoint (`POST /{ig-user-id}/media`), just `media_type=REELS` + `video_url` instead of the current post parameters. Optionally expose `share_to_feed` (recommend defaulting `true`).
   - **Facebook: a genuinely separate internal method.** Reels do **not** use the existing feed-post endpoint at all. They require the distinct 3-phase `/{page-id}/video_reels` flow: `start` (get `video_id` + `upload_url`) → upload bytes to `upload_url` → `finish` (with `video_state=PUBLISHED`). Isolate this as its own internal method, dispatched to from `publish()` based on `content_type`, while `publish()`'s external signature stays the same as every other adapter.

4. **Facebook Reels have a separate rate limit: 30 API-published reels per 24 hours, per Page.** This must be checked *before* calling the API (count recent successful Facebook-reel publishes for that Page in the last 24h), not discovered by handling a rejection.

5. **No new post states.** `Draft → Scheduled → Processing → Publishing → Published/Failed` already covers this — content type is job metadata, not a new pipeline.

6. **Pick one over-length policy and apply it to all three.** If a user selects "Reel/Short" but their video exceeds that platform's duration cap, either reject clearly and ask them to trim (recommended default — simplest, most predictable) or auto-trim (a later enhancement). Whichever you pick, apply it identically for YouTube, Instagram, and Facebook — don't let each platform's implementation silently diverge.

---

## 6. Database Changes (Supabase migration)

- Add `content_type` (check constraint: `'post'`, `'reel'`, default `'post'`) to wherever per-platform post targeting already lives (e.g. `publish_jobs`).
- Add `content_type` to `media_variants` as well (or fold into an existing compound key with `platform`), so "the Instagram Reel variant" and "the Instagram Post variant" for the same post are distinctly retrievable.
- No new tables needed.

---

## 7. Build Steps (in this exact order — YouTube → Instagram → Facebook, as confirmed — do not reorder)

### Step 1 — YouTube Shorts

1. Wire the `content_type` choice into the Create Post UI and through to the job record for YouTube targets.
2. Add a Short variant generator to Media Service: 9:16 (or 1:1), duration validated/capped at ≤180 seconds per the reject-or-trim policy you establish (Section 5, point 6) — establish this policy here since YouTube is first, and reuse it identically in Steps 2 and 3.
3. Feed the Short variant through the **unmodified** existing YouTube `publish()`/`prepareMedia()`/`getStatus()`. Do not add any content_type branching inside the YouTube adapter itself.
4. Optionally append "#Shorts" to the description for classification reliability.

**Definition of done:** a real Short (9:16, under 3 minutes) uploaded through the unmodified existing adapter appears in the channel's Shorts shelf, confirmed on YouTube directly.

### Step 2 — Instagram Reels

1. Add a Reel variant generator to Media Service: 9:16, ≤90 seconds, using the same reject-or-trim policy from Step 1.
2. In the existing Instagram `publish()`, add a branch: when `content_type = 'reel'`, create the media container with `media_type=REELS` and `video_url` instead of the current post parameters; support an optional `share_to_feed` (default `true`).
3. Confirm `getStatus()` needs no changes — same container status fields apply.

**Definition of done:** a real reel appears in the connected account's Reels tab, confirmed on Instagram directly, and its `media_product_type` (not `media_type`) reads `REEL` when queried.

### Step 3 — Facebook Reels

1. Verify the Page permissions from Section 2.
2. Add a Reel variant generator to Media Service: 9:16, 1080×1920 recommended (540×960 minimum), 3–90s, 24–60fps, same reject-or-trim policy as Steps 1–2.
3. Implement a distinct internal method (e.g. `publishFacebookReel()`) for the 3-phase flow — start → transfer → finish — as described in Section 5, point 3.
4. In the Facebook adapter's `publish()`, dispatch to this new method when `content_type = 'reel'`, and to the existing feed-post flow otherwise — the adapter's external interface stays unchanged.
5. Before dispatching any Facebook reel job, count successful Facebook-reel publishes for that Page in the last 24 hours; if at 30, hold the job for delayed retry with a clear status instead of calling the API.

**Definition of done:** a real reel appears on the connected Facebook Page's Reels, confirmed on Facebook directly; a forced 31st reel attempt within 24 hours is caught by the internal count check before any API call is made, and is handled as a delayed/queued job with a clear status rather than a crash or silent failure.

---

## 8. First Action

Start with **Step 1 (YouTube) only**. When its self-check (Section 3, loop Step 2) passes cleanly with a real Short confirmed on a real YouTube channel, produce the Step 1 completion report and stop and wait for approval before touching Step 2, exactly as Section 3 requires. Do not proceed to Step 2 or Step 3 under any circumstances until the user explicitly approves each in turn.
