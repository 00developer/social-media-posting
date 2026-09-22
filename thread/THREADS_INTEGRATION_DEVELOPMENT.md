                        # Threads Integration — Development Document

### SocialPush — Adding Threads as a connected platform

**Context:** Facebook, Instagram, YouTube (including Reels/Shorts), LinkedIn, and Pinterest are already connected and publishing successfully. This document adds **Threads** — Meta's text-first platform. It shares Meta's container-publishing model (like Instagram), but has real differences worth calling out explicitly.

**How to use this:** Feed this document to Antigravity in the same project. It assumes the **Operating Protocol** and **Engineering Rules** from `ANTIGRAVITY_DEVELOPMENT_PROMPT.md` are still in effect — the condensed version is repeated in Section 5 so this document also works standalone.

---

## 1. Prerequisites — Threads Developer Setup

1. **Check whether the Threads API product can be added to the same Meta app already used for Facebook/Instagram**, at developers.facebook.com, rather than registering an entirely new app — Meta apps can host multiple products (Facebook Login, Instagram Graph API, Threads API) side by side. Confirm this before assuming a fresh app is required.
2. Add the **Threads API** product to the app, requesting at minimum the `threads_basic` and `threads_content_publish` scopes.
3. **Important:** even though the existing Meta app may already be App-Review-approved for Facebook/Instagram permissions, **Threads permissions need their own separate App Review submission** — approval for one product's scopes does not carry over to a newly-added product's scopes. Publishing works against your own developer/test account without this review; real end users need the review completed first (the same shape of gate already navigated for Facebook/Instagram, just a second, separate pass for Threads specifically).
4. Threads also requires **Tech Provider Verification** as part of getting to production — a business-verification step, separate from App Review itself; start this in parallel with Step 1's build since, like LinkedIn's MDP review, it's a real wait, not a code task.
5. Configure the OAuth redirect URI (can likely reuse the existing Meta redirect handling already built for Facebook/Instagram, extended with a Threads-specific scope set).

### Environment variables

No new client ID/secret should be needed if Threads is added to the existing Meta app — confirm the existing `META_CLIENT_ID`/`META_CLIENT_SECRET` (or equivalently named) variables cover this. If a separate Threads-specific app is used instead, add:

```
THREADS_CLIENT_ID=...
THREADS_CLIENT_SECRET=...
THREADS_REDIRECT_URI=...
```

---

## 2. Working Logic — What's Different About Threads

1. **Same two-step container model as Instagram — reuse the mental model, not necessarily the code.** `POST /{threads-user-id}/threads` creates a media container (`media_type`: `TEXT`, `IMAGE`, `VIDEO`, or `CAROUSEL`), then `POST /{threads-user-id}/threads_publish` with the returned `creation_id` actually publishes it. This is structurally the same shape already built for Instagram — a good candidate for a shared helper, but Threads is its own separate API host (`graph.threads.net`), so don't assume the Instagram adapter's HTTP client/base URL can be reused as-is.

2. **Text posts are capped at 500 characters — different from every platform connected so far.** Emojis and URLs count by UTF-8 byte length, not character count as a person would read it, so a naive `string.length` check can under-count. Show a visible character-count warning (same principle as X's 280-character limit) rather than silently truncating.

3. **Media specs are distinct from Instagram's, not identical:** images up to 8MB, 320–1440px width, aspect ratio up to 10:1 (notably wider allowance than Instagram); video up to 1920px wide, up to 5 minutes, up to 1GB, H264/HEVC. Build a dedicated Threads variant in Media Service rather than assuming the Instagram variant satisfies these limits — the aspect ratio ceiling in particular is unusually permissive and shouldn't be conflated with Instagram's stricter rules.

4. **Media is fetched and processed asynchronously by Meta after container creation — don't publish immediately after creating the container.** Especially for video, Meta needs time to fetch and process the media from the provided URL before the container is actually ready to publish. Rather than a blind fixed delay, check the container's status before calling `threads_publish` (Threads containers expose a status concept the same way Instagram's do) and only publish once it's ready — this is the same "poll before assuming success" principle already applied to YouTube's processing pipeline.

5. **No native scheduling exists on Threads' API at all** — like LinkedIn, there's no `scheduled_at`-style parameter to misuse. The existing "Scheduling Service decides when, adapter publishes now" pattern applies with zero special-casing.

6. **Rate limiting has an official live-usage endpoint — use it instead of a self-maintained counter.** Threads profiles are capped at 250 API-published posts per rolling 24-hour window (carousels count as one post). Unlike Facebook Reels (where no such endpoint exists and a local count must be maintained), Threads exposes `GET /{threads-user-id}/threads_publishing_limit`, returning current `quota_usage` against `quota_total`. Query this before dispatching a publish, rather than reimplementing a local 24-hour counter — it's the authoritative source and avoids drift between what SocialPush thinks the usage is and what Meta actually has recorded.

7. **Reuse the existing Meta long-lived token refresh logic** already built for Facebook/Instagram — Threads tokens follow the same general Meta access-token lifecycle. Confirm the exact expiry/refresh endpoint behavior for Threads specifically during Step 1's testing rather than assuming it's byte-for-byte identical, but structure the code to extend the existing refresh utility rather than writing a new one from scratch.

8. **Supported content types: text, image, video, carousel (up to 20 items).** GIFs and Stories are not supported via the API — don't build UI affordances implying they are. Carousel support is not required for MVP (SocialPush's existing single-image/video flow covers the common case) — treat multi-item carousels as a later enhancement, not part of the initial adapter.

---

## 3. Database Changes (Supabase migration)

- `social_accounts`: extend the `platform` check constraint to allow `'threads'`.
- No new tables required. Unlike Pinterest (boards) or LinkedIn (member vs. organization targets), Threads has no equivalent structural concept beyond what `social_accounts` and `media_variants` already model.
- `media_variants`: no schema change — a Threads variant is just another row with `platform = 'threads'`.

---

## 4. Backend Implementation — Step by Step

### Step 1 — Threads OAuth Connect (extends Account Service)

- Confirm whether the Threads product is added to the existing Meta app (Section 1) or a separate one, and build the authorization flow accordingly, requesting `threads_basic` + `threads_content_publish`.
- Handle the callback, exchange for tokens, encrypt and store in `social_accounts` with `platform = 'threads'`, reusing the existing Meta token-encryption pattern.
- Extend the existing Meta refresh-token logic to cover Threads tokens (Working Logic point 7), confirming actual expiry behavior against the real API rather than assuming.
- Frontend: add a "Connect Threads" button alongside the existing platform buttons.

**Definition of done:** a real user connects their Threads account via OAuth, verifiable directly in `social_accounts`.

### Step 2 — Media Variant Generation for Threads (extends Media Service)

- Add a Threads case to the existing variant-generation function using the specs from Working Logic point 3 (image ≤8MB, 320–1440px width, ≤10:1 ratio; video ≤1920px wide, ≤5min, ≤1GB).
- Store the result as a `media_variants` row with `platform = 'threads'`.

**Definition of done:** uploading a test image/video produces a variant that passes Threads' own size/format constraints, verified by inspecting the generated file directly.

### Step 3 — Threads Adapter: `prepareMedia()` / `publish()` / `getStatus()`

- Implement the adapter in `/services/publishing-service`, matching the existing interface shape.
- `publish()`: create the container (`POST /{threads-user-id}/threads`) with the prepared media/text, **wait for the container to be ready** (Working Logic point 4 — poll status rather than a fixed delay, especially for video) before calling `POST /{threads-user-id}/threads_publish`.
- Before dispatching, query `GET /{threads-user-id}/threads_publishing_limit` (Working Logic point 6) and hold the job for delayed retry if the account is at its 250-post/24h cap, rather than letting the publish call fail.
- `getStatus()`: map the container/publish result onto the existing post state machine — reuse it, don't extend it with new states.
- Wire into the existing per-platform worker so a Threads job runs as its own independent job, same fan-out logic already in place.

**Definition of done:** scheduling a post that includes Threads among its target platforms results in a real post appearing on the connected Threads profile, at the scheduled time; a deliberately-broken publish (e.g. invalid token) retries and then lands on `Failed` with a clear error, without affecting a simultaneous publish to any other platform for the same post; a forced 251st post within 24 hours is caught by the `threads_publishing_limit` check before hitting the publish endpoint.

### Step 4 (optional) — Threads Analytics

- Extend the Analytics Service to pull metrics via `threads_manage_insights`, once that scope is included in the App Review submission — same periodic-pull pattern already used for other platforms.

---

## 5. Operating Protocol (condensed — full version in `ANTIGRAVITY_DEVELOPMENT_PROMPT.md`)

For **each step in Section 4**:

1. **Build** only that step's scope.
2. **Self-check:** lint + type-check + tests; boot the service and actually connect a real Threads test account and publish a real post, confirming it appears correctly on Threads; confirm the container-ready check (Working Logic point 4) actually waits rather than racing ahead for a real video post.
3. **Fix** anything broken before calling the step done.
4. **Report**, same format as the main prompt.
5. **STOP.** Do not start the next step until you get an explicit go-ahead — and do not attempt any step requiring App-Review-gated scopes (beyond the developer's own test account) until the user explicitly confirms that review has been granted, the same way LinkedIn's Company Page step was gated on MDP approval.

---

## 6. Rules Specific to This Addition

- Encrypt Threads tokens at the application level, same as every other platform.
- Never call `threads_publish` immediately after creating a container without confirming it's actually ready — this is especially likely to cause silent failures for video.
- Query `threads_publishing_limit` before dispatching a publish rather than maintaining a separate local counter, since Threads uniquely offers this as an authoritative live endpoint.
- Keep the adapter interface (`prepareMedia`, `publish`, `getStatus`) identical in shape to every other adapter already built.
- Don't invent a Threads-only post status — map outcomes onto the existing state machine.
- Character-limit and media-spec checks show a visible warning; never silently truncate or silently downgrade media.

---

_End of Threads Integration Development Document._
