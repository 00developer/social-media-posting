# LinkedIn Integration — Development Document
### SocialPush — Adding LinkedIn as a connected platform

**Context:** Facebook, Instagram, and YouTube (including Reels/Shorts) are already connected and publishing successfully. This document adds **LinkedIn** — which has a fundamentally different access model from every platform connected so far, called out explicitly below.

**How to use this:** Feed this document to Antigravity in the same project. It assumes the **Operating Protocol** and **Engineering Rules** from `ANTIGRAVITY_DEVELOPMENT_PROMPT.md` are still in effect — the condensed version is repeated in Section 5 so this document also works standalone.

---

## 1. Prerequisites — LinkedIn Developer Setup

1. Go to **linkedin.com/developers** → create an app. **LinkedIn requires every app to be linked to a LinkedIn Company Page at creation time** — even if you only intend to support personal-profile posting at first, you need at least a placeholder Company Page to register the app against.
2. Verify the app (a separate step in the developer portal from any product/scope approval).
3. Add the **"Share on LinkedIn"** product to the app — this is **self-serve, no approval needed**, and grants `w_member_social` (post to an authenticated member's own profile).
4. **Separately, and only if/when Company Page posting is wanted:** apply for the **Marketing Developer Platform (MDP)** to get `w_organization_social` + `r_organization_social`. This is a manual review — LinkedIn checks for a legitimate business use case and rejects anything that looks like a spam/scraping tool. Approval timelines vary from days to over a month. **Start this application now, in parallel with Step 1's build, since it's the long pole.**
5. Configure the OAuth 2.0 redirect URI matching this project's callback route.

### Environment variables to add
```
LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...
LINKEDIN_REDIRECT_URI=...
```
Backend-only, same handling as every other platform credential in this project.

---

## 2. Working Logic — What's Different About LinkedIn

1. **Two distinct posting targets exist, gated differently.** Personal profile (`w_member_social`, self-serve) vs. Company Page (`w_organization_social`, requires MDP approval + the connected user having an admin-level role — `ADMINISTRATOR`, `DIRECT_SPONSORED_CONTENT_POSTER`, or `RECRUITING_POSTER` — on that specific page). Design the Account Service and UI so Company Page support can be added later without reworking what's built for personal profiles — e.g. the same `social_accounts` row shape should be able to represent either target type.

2. **Every API call needs a `Linkedin-Version` header** (format `YYYYMM`, e.g. `202506`) — unlike Facebook/Instagram/YouTube/Pinterest, LinkedIn versions its REST API this way on every request, not via the URL path. Pin a specific version in configuration and update it deliberately, not automatically.

3. **Refresh tokens have a hard 365-day ceiling — this is different from every other platform connected so far.** Facebook and Pinterest use a rolling/renewable refresh pattern; LinkedIn's refresh token itself expires at 365 days no matter what, and access tokens expire every 60 days (refreshed using the refresh token up until that point). There is no way to silently keep a connection alive past 365 days — the user must fully reconnect. Build a proactive "reconnect needed" state (e.g. flag accounts within 30 days of the 365-day ceiling) rather than letting the connection silently die and only discovering it when a publish fails.

4. **No native scheduling exists at all.** Unlike Pinterest, LinkedIn's API only supports immediate publishing — there's no `scheduled_at`-style parameter to accidentally misuse. This is actually the simplest platform so far in that respect: the existing "Scheduling Service decides when, adapter publishes now" pattern applies with zero special-casing.

5. **Media upload is a two-step reference pattern**, similar in shape to YouTube/Pinterest: upload the image via `/rest/images` or video via `/rest/videos` (video upload is chunked, tracked via `ETag`) first to get back a URN, then reference that URN when creating the post via `/rest/posts`.

6. **Rate limits are modest and per-member.** Roughly 100–150 API calls per day per connected member for the Share on LinkedIn product (LinkedIn's own product page is the source of truth — confirm the current number when implementing, as these limits are occasionally adjusted). Low enough that it's worth tracking usage per connected account the same way YouTube's quota is tracked, even though the ceiling itself is higher relative to typical posting volume.

7. **Supported content types (via the Posts API):** text, images, video, and article/link shares (with an optional thumbnail — LinkedIn will crawl the linked page for one if omitted). Polls are not supported via the API. Don't build UI affordances for post types the API can't actually deliver.

---

## 3. Database Changes (Supabase migration)

- `social_accounts`: extend the `platform` check constraint to allow `'linkedin'`. Add a nullable `target_type` column (`'member'` / `'organization'`) so the same table can represent either a personal-profile connection or a Company Page connection without a schema change later. Add nullable `organization_urn text` for Company Page connections (populated once Step 2/Company Page support is built).
- Add a nullable `refresh_token_expires_at timestamptz` column to `social_accounts` (if one doesn't already exist generically) — needed to implement the proactive reconnect-warning logic from Working Logic point 3. This is LinkedIn-specific behavior other platforms don't need, but the column can live on the shared table.
- `media_variants`: no schema change — a LinkedIn variant is just another row with `platform = 'linkedin'`.

---

## 4. Backend Implementation — Step by Step

### Step 1 — LinkedIn OAuth Connect, Personal Profile (extends Account Service)
- OAuth flow with scopes `openid profile w_member_social` (add `email` if you want it for display purposes).
- Encrypt + store both tokens in `social_accounts` with `platform = 'linkedin'`, `target_type = 'member'`, plus `refresh_token_expires_at` set to now + 365 days.
- Implement standard 60-day access-token refresh using the refresh token, same shape as existing refresh logic — but also implement the reconnect-warning check from Working Logic point 3 (surface a "reconnect LinkedIn" prompt in the dashboard once within 30 days of the 365-day ceiling).
- Frontend: "Connect LinkedIn" button alongside existing platform buttons.

**Definition of done:** a real user connects their personal LinkedIn profile and the connection is verifiable directly in `social_accounts`.

### Step 2 — Media Variant + LinkedIn Adapter (Post Service / Publishing Service)
- Media Service: LinkedIn doesn't enforce a strict aspect ratio the way Instagram/Pinterest do — a reasonable default (e.g. 1.91:1 for link-style images, or pass through images largely as-is within LinkedIn's size limits) is enough; confirm current size/format limits from LinkedIn's docs rather than assuming they match another platform's.
- Implement the LinkedIn adapter (`prepareMedia()`, `publish()`, `getStatus()`) matching the existing interface shape: upload media via `/rest/images` or `/rest/videos` to get a URN, then `POST /rest/posts` with the member's URN as author, the `Linkedin-Version` header, and the media reference.
- Wire into the existing worker/fan-out pattern.

**Definition of done:** scheduling a post that includes LinkedIn among its targets results in a real post appearing on the connected personal profile at the scheduled time (not immediately — since there's no native scheduling to accidentally rely on, confirm your own queue is what's actually controlling the timing).

### Step 3 — LinkedIn OAuth Connect + Adapter, Company Page (only once MDP approval from Section 1 is granted)
- Extend the OAuth flow to request `w_organization_social` + `r_organization_social` once approved.
- After connecting, list the pages the member administers and let them pick one (store as a `social_accounts` row with `target_type = 'organization'` and the resolved `organization_urn`).
- Extend the adapter's `publish()` to use the organization's URN as author instead of the member's, when the target account is an organization-type connection — reuse the same underlying post-creation logic, just a different `author` field.

**Definition of done:** a real post appears on the connected Company Page, published by the SocialPush integration, verified directly on LinkedIn.

### Step 4 (optional) — LinkedIn Analytics
- Extend the Analytics Service to pull available post-level metrics (LinkedIn's analytics permissions are more limited than Meta/YouTube's — check what's actually available under the approved product before committing to specific metrics in the UI).

---

## 5. Operating Protocol (condensed — full version in `ANTIGRAVITY_DEVELOPMENT_PROMPT.md`)

For **each step in Section 4**:
1. **Build** only that step's scope.
2. **Self-check:** lint + type-check + tests; boot the service and actually connect a real LinkedIn test account and publish a real post, confirming it appears correctly on LinkedIn (right profile or right page).
3. **Fix** anything broken before calling the step done.
4. **Report**, using the same format as the main prompt, including a note on MDP approval status before attempting Step 3.
5. **STOP.** Do not start the next step until you get an explicit go-ahead — **Step 3 in particular cannot start until MDP approval is actually granted, regardless of user approval to proceed**, since the API will reject `w_organization_social` requests without it.

---

## 6. Rules Specific to This Addition

- Encrypt LinkedIn's access token and refresh token at the application level, same as every other platform.
- Always send the `Linkedin-Version` header on every LinkedIn API call — pin the version in config, don't hardcode it inline in multiple places.
- Never let a LinkedIn connection silently fail at the 365-day refresh-token ceiling — the reconnect-warning logic from Working Logic point 3 is not optional.
- Never attempt Company Page posting logic (Step 3) before MDP approval is confirmed — the API call will simply fail, and building against it early wastes effort against an interface that isn't authorized yet.
- Keep the adapter interface (`prepareMedia`, `publish`, `getStatus`) identical in shape to every other adapter already built.

---

*End of LinkedIn Integration Development Document.*
