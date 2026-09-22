# SocialPush — Threads Integration — AI Development Agent Prompt
### For use with Antigravity (Gemini 3.1 Pro High)

**How to use this:** Paste this entire document as your instruction to the agent, in the **same Antigravity project** where SocialPush already exists (Facebook, Instagram, YouTube, LinkedIn, and Pinterest are already connected and publishing successfully). Keep `THREADS_INTEGRATION_DEVELOPMENT.md` in the same folder as extra reference — this file is the direct, step-gated build instruction the agent should actually follow.

---

## Role

You are an autonomous senior full-stack engineer working on an **existing, already-partially-built codebase** — SocialPush, a multi-platform social media publishing SaaS. Facebook, Instagram, YouTube, LinkedIn, and Pinterest are already fully connected and publishing successfully. Your job now is to add **Threads** as a new connected platform, by extending the existing Account Service, Media Service, and Publishing Service — not by rebuilding them. Threads shares Meta's container-publishing model already used for Instagram, but has real differences — read Section 5 carefully before writing any code. You must follow the **Operating Protocol** in Section 3 exactly, on every single step, with zero exceptions.

---

## 1. Context — What Already Exists (do not rebuild any of this)

- **Account Service** already implements OAuth for Facebook, Instagram, YouTube, LinkedIn, and Pinterest — authorization redirect, callback handling, token exchange, application-level token encryption, refresh-token renewal, and storage in the `social_accounts` table. In particular, the **Meta long-lived token refresh logic already built for Facebook/Instagram** is the starting point to extend for Threads, since Threads is also a Meta product.
- **Publishing Service** already implements the adapter pattern — every connected platform exposes `prepareMedia()`, `publish()`, `getStatus()` with the same shape, called by the worker without platform-specific branching outside the adapter files.
- **The Instagram adapter already uses a two-step container-then-publish model** — Threads uses the same conceptual pattern, so its shape should feel familiar, but Threads is a separate API host (`graph.threads.net`) with its own limits — do not assume the Instagram adapter's client/config can just be pointed at a different URL and work unchanged.
- The **post state machine**, **per-platform fan-out job logic**, and **worker/queue system** (Redis + BullMQ) are already built and working end to end.
- **Every platform except Pinterest and LinkedIn so far has not needed an "App Review pending" gate on the connect flow itself.** Threads does, similar in shape to what was already built for LinkedIn's Company Page step — read Section 3's approval-gate rule carefully.

**Your job is to extend these existing systems so Threads plugs into them — never fork a separate pipeline.** Where Threads' model genuinely differs (the async media-processing wait, the live rate-limit endpoint, the 500-char/UTF-8-byte limit), isolate that difference clearly rather than forcing it to look identical to Instagram where it doesn't actually behave the same way.

---

## 2. Prerequisites — Threads Developer Setup

Confirm these before writing code (ask the user to confirm if you cannot verify it yourself):

1. Whether the **Threads API product has been added to the existing Meta app** already used for Facebook/Instagram, or whether a separate app was created — build the OAuth flow to match whichever is actually true.
2. The `threads_basic` and `threads_content_publish` scopes have been requested on that app.
3. **Threads permissions require their own separate Meta App Review, even on an app already approved for Facebook/Instagram scopes.** Publishing works against the developer's own test account without this; real end users cannot connect until the review is granted. Treat this exactly like LinkedIn's MDP-approval gate — see Section 3.
4. **Tech Provider Verification** (a business-verification step, separate from App Review) has been started, since it's on the critical path to production the same way LinkedIn's MDP review was.
5. OAuth redirect URI configured (may reuse existing Meta redirect handling, extended with Threads scopes).
6. Environment variables — confirm whether existing `META_CLIENT_ID`/`META_CLIENT_SECRET`-style variables cover this (if Threads is on the same app) or whether separate ones are needed:
```
THREADS_CLIENT_ID=...      # only if a separate app was used
THREADS_CLIENT_SECRET=...  # only if a separate app was used
THREADS_REDIRECT_URI=...
```

---

## 3. Operating Protocol — CRITICAL, follow exactly every step, no exceptions

For **every step** listed in Section 7, follow this exact loop. Do not shortcut it, do not combine steps, do not skip Step 5.

### Step 1 of the loop — Build
Implement only what is in scope for the current step's numbered instructions in Section 7. Do not implement a later step early. Do not skip part of the current step.

### Step 2 of the loop — Self-check (mandatory before reporting anything as done)
- Run the linter and the type-checker on all changed/new code.
- Run the full automated test suite.
- Boot the affected service(s) and manually test the actual flow with a real Threads test account — not a mock. For the OAuth step, actually complete the consent flow. For the publish step, actually confirm a real post appears on the actual Threads profile afterward.
- **Specifically confirm the container-ready wait/poll (Section 5, point 4) actually blocks until the container is ready for at least one real video post** — a race condition here would silently fail intermittently rather than obviously, so don't skip testing it with real video, not just text/image.
- Confirm the character-limit check counts UTF-8 bytes, not JS/naive string length, using a real test string containing emojis (Section 5, point 2) — a naive length check will pass incorrectly otherwise.
- If the step touched a Supabase table: confirm RLS is enabled and actually attempt cross-user access as a second test user to confirm it's blocked.
- Actively search for: broken imports, unhandled promise rejections, missing environment variables, failing API calls, console/runtime errors, type errors, dead code, and anything that duplicates logic that already exists for other platforms instead of extending it.

### Step 3 of the loop — Fix
Fix every issue found in Step 2 before moving on. Never report a step as complete while a test is failing, the app fails to boot, or the flow you just built visibly errors out. If you find yourself fixing the same issue more than 3 times without success, **stop and report the blocker** instead of continuing to patch blindly.

### Step 4 of the loop — Report
Produce a completion report using exactly this format:

```
## Threads Step [N] — [Step Name] — Complete

### What was built
- (bullet list of what was actually implemented, step by step)

### Self-check performed
- Lint: pass / fail
- Type-check: pass / fail
- Tests: X passed / Y failed
- RLS cross-user test (if applicable): pass / fail / not applicable
- Container-ready wait tested with real video (Step 3 only): pass / fail
- UTF-8 byte-length check tested with real emoji input (Step 2/3 only): pass / fail
- Manual smoke test: (what you actually did with a real Threads account, and what happened)

### Issues found & fixed
- (bullet list, or "None found")

### Known limitations / intentionally deferred
- (bullet list, or "None")

### Waiting for your approval to start Step [N+1] — [Next Step Name]
```

### Step 5 of the loop — STOP and wait for explicit approval
Do not write, generate, or scaffold **any** code for the next step. Wait for the user to explicitly say something like "go ahead," "approved," "start step [N+1]," or "yes continue."

- If the user gives feedback or asks for changes instead, apply them, repeat Step 2 (self-check) and Step 3 (fix), and produce an **updated** completion report for the same step — still without starting the next step.
- If the user asks a question, answer it in place without starting new code.

**You must never:**
- Auto-start the next step right after finishing the current one.
- Mark a step complete while it has failing tests, a broken build, an untested flow, or an unverified container-ready wait.
- Silently drop a numbered instruction and still call the step "done."
- Build a duplicate OAuth system, adapter interface, or state machine — extend the existing ones.
- Call `threads_publish` without first confirming the container is actually ready.
- Publish without first checking `threads_publishing_limit` for available quota.
- Treat Threads permissions as already approved just because the existing Meta app is approved for Facebook/Instagram — confirm the Threads-specific App Review status explicitly before assuming real (non-developer) users can connect.
- Do the steps in Section 7 out of order.

---

## 4. Engineering Rules for This Addition

- Encrypt Threads' `access_token` and `refresh_token` at the application level before storing — same as every other platform.
- Never expose any Threads/Meta client secret or the Supabase service role key to the frontend.
- The adapter you write must match the existing adapter interface shape (`prepareMedia`, `publish`, `getStatus`) exactly.
- Map Threads' outcomes onto the **existing** state machine — do not invent a Threads-only status value.
- All new Supabase schema changes are versioned Supabase CLI migrations, consistent with the existing tables.

---

## 5. Working Logic — What's Actually Different About Threads (read before Step 1)

1. **Same two-step container model as Instagram, conceptually — but a separate API host and separate limits.** `POST /{threads-user-id}/threads` creates a container (`media_type`: `TEXT`/`IMAGE`/`VIDEO`/`CAROUSEL`), then `POST /{threads-user-id}/threads_publish` with the returned `creation_id` publishes it. Base URL is `graph.threads.net`, not the standard Graph API host used for Instagram/Facebook.

2. **500-character text limit, counted in UTF-8 bytes, not display characters.** Emojis and some Unicode text take multiple bytes each — a naive `.length` check in most languages counts UTF-16 code units or characters, not UTF-8 bytes, and will under-count. Compute the actual UTF-8 byte length for the limit check. Show a visible warning; never silently truncate.

3. **Media specs are Threads-specific, not the same as Instagram's:** images up to 8MB, 320–1440px width, aspect ratio up to **10:1** (unusually wide allowance); video up to 1920px wide, up to 5 minutes, up to 1GB, H264/HEVC codec. Build a dedicated Threads variant — do not assume the existing Instagram variant already satisfies these.

4. **Meta processes media asynchronously after container creation — do not call `threads_publish` immediately after creating the container.** Especially for video, there's a real delay while Meta fetches and processes the media from the provided URL. Poll the container's status and only call `threads_publish` once it reports ready, rather than a blind fixed sleep — this mirrors the "poll before assuming success" pattern already used for YouTube's processing pipeline.

5. **No native scheduling exists on Threads' API.** Like LinkedIn, there's no scheduling parameter to misuse — the existing "Scheduling Service decides when, adapter publishes now" pattern applies with zero special-casing.

6. **Threads provides a live, authoritative rate-limit endpoint — use it instead of a local counter.** `GET /{threads-user-id}/threads_publishing_limit` returns current `quota_usage` against a `quota_total` (250 posts/24h). Query this before dispatching a publish and hold the job for delayed retry if at the limit — this is different from Facebook Reels, where no such endpoint exists and a local count had to be built; here, prefer Meta's own live number over reimplementing the count yourself.

7. **Reuse and extend the existing Meta long-lived token refresh logic** already built for Facebook/Instagram, rather than writing a new refresh implementation — but verify Threads' actual expiry/refresh behavior against the real API during Step 1's self-check rather than assuming it's identical.

8. **Supported: text, image, video, carousel (≤20 items). Not supported via API: GIFs, Stories.** Carousel support is out of scope for this initial build — SocialPush's existing single-image/video flow covers Threads' MVP needs; don't build carousel UI/logic unless explicitly asked later.

---

## 6. Database Changes (Supabase migration)

- `social_accounts`: extend the `platform` check constraint to allow `'threads'`.
- `media_variants`: no schema change — a Threads variant is just another row with `platform = 'threads'`.
- No new tables required.

---

## 7. Build Steps (in this exact order — do not reorder, merge, or skip ahead)

### Step 1 — Threads OAuth Connect (extends Account Service)

1. Confirm whether Threads is on the existing Meta app or a separate one (Section 2), and build the authorization URL accordingly, requesting `threads_basic` and `threads_content_publish`.
2. Handle the callback, exchange for tokens, encrypt using the existing token-encryption utility.
3. Insert into `social_accounts` with `platform = 'threads'`, using the Supabase service role key, same pattern as existing platforms.
4. Extend the existing Meta refresh-token logic to cover Threads tokens (Working Logic point 7), and confirm the actual behavior against the real API rather than assuming it matches Facebook/Instagram exactly.
5. Frontend: add a "Connect Threads" button alongside the existing platform buttons.

**Definition of done for this step:** a real user connects their Threads account via OAuth, verified directly in `social_accounts` — using the developer's own test account, since real end users cannot connect until Threads' separate App Review is granted (Section 2, point 3).

### Step 2 — Media Variant Generation for Threads (extends Media Service)

1. Add a Threads case to the existing variant-generation function using the specs from Working Logic point 3.
2. Confirm the original uploaded file is still never modified — only a new derived variant is created.
3. Store the result as a `media_variants` row with `platform = 'threads'`.

**Definition of done for this step:** a generated image/video variant passes Threads' own size/format/aspect-ratio limits, verified by inspecting the generated file directly.

### Step 3 — Threads Adapter: `prepareMedia()` / `publish()` / `getStatus()`

1. In `/services/publishing-service`, create the Threads adapter implementing the same interface shape as the existing adapters.
2. `prepareMedia()` uses the variant from Step 2.
3. `publish()`: create the container, **poll for container-ready status before calling `threads_publish`** (Working Logic point 4) — do not use a fixed delay. Before dispatching, check `threads_publishing_limit` (Working Logic point 6) and hold for delayed retry if at capacity.
4. `getStatus()`: map the result onto the existing post state machine — reuse it, don't extend it with new states.
5. Wire the adapter into the existing per-platform worker so a Threads job runs as its own independent job (existing fan-out logic — do not special-case Threads in the worker dispatch code).

**Definition of done for this step:** scheduling a post that includes Threads among its target platforms results in a real post appearing on the connected Threads profile, at the actual scheduled time; a deliberately-broken publish (e.g. invalid token) retries appropriately and then lands on `Failed` with a clear error, without affecting a simultaneous publish to any other platform for the same post; a forced 251st post within 24 hours is caught by the `threads_publishing_limit` check *before* any publish call is attempted.

### Step 4 — Threads Analytics (optional, only after Steps 1–3 are approved and confirmed working, and only if `threads_manage_insights` was included in the App Review submission)

1. Extend the existing Analytics Service to pull available metrics for published Threads posts, same periodic-pull pattern already used for other platforms.
2. Write results into the existing `analytics` table with `platform = 'threads'`.

---

## 8. First Action

Start with **Step 1 only**. When Step 1's self-check (Section 3, loop Step 2) passes cleanly with a real connected Threads test account, produce the Step 1 completion report and then stop and wait for approval before touching Step 2, exactly as Section 3 requires. Do not proceed to any later step under any circumstances until the user explicitly approves each in turn, and do not treat Threads as available to real (non-developer) end users until the user explicitly confirms Threads' own App Review has been granted.
