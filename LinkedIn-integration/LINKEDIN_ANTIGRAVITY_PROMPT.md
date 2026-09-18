# SocialPush — LinkedIn Integration — AI Development Agent Prompt
### For use with Antigravity (Gemini 3.1 Pro High)

**How to use this:** Paste this entire document as your instruction to the agent, in the **same Antigravity project** where SocialPush already exists (Facebook, Instagram, and YouTube — including Reels/Shorts — are already connected and publishing successfully). Keep `LINKEDIN_INTEGRATION_DEVELOPMENT.md` in the same folder as extra reference — this file is the direct, step-gated build instruction the agent should actually follow.

---

## Role

You are an autonomous senior full-stack engineer working on an **existing, already-partially-built codebase** — SocialPush, a multi-platform social media publishing SaaS. Facebook, Instagram, and YouTube are already fully connected and publishing successfully. Your job now is to add **LinkedIn** as a new connected platform, by extending the existing Account Service, Media Service, and Publishing Service — not by rebuilding them. LinkedIn has a fundamentally different access-approval model from every platform connected so far — read Section 5 carefully before writing any code. You must follow the **Operating Protocol** in Section 3 exactly, on every single step, with zero exceptions — this protocol matters more than speed.

---

## 1. Context — What Already Exists (do not rebuild any of this)

- **Account Service** already implements OAuth for Facebook, Instagram, and YouTube — authorization redirect, callback handling, token exchange, application-level token encryption, refresh-token renewal, and storage in the `social_accounts` table.
- **Publishing Service** already implements the adapter pattern — every connected platform exposes `prepareMedia()`, `publish()`, `getStatus()` with the same shape, called by the worker without platform-specific branching outside the adapter files.
- **Media Service** already generates platform-specific variants from a single untouched original.
- The **post state machine**, **per-platform fan-out job logic**, and **worker/queue system** (Redis + BullMQ) are already built and working end to end.
- **Every platform so far has used a renewable/rolling refresh-token pattern.** LinkedIn is the first platform where the refresh token has a hard, non-renewable expiry — see Section 5, point 3. Do not assume the existing refresh logic covers this without extension.

**Your job is to extend these existing systems so LinkedIn plugs into them — never fork a separate pipeline.** Where LinkedIn's model genuinely differs (the two-tier approval system, the version header, the hard refresh-token ceiling), isolate that difference clearly rather than forcing it to look like the other platforms where it doesn't actually behave the same way.

---

## 2. Prerequisites — LinkedIn Developer Setup

Confirm these exist before writing code (ask the user to confirm if you cannot verify it yourself):

1. A LinkedIn developer app registered at **linkedin.com/developers**, linked to a LinkedIn Company Page (LinkedIn requires this at app-creation time regardless of whether Company Page posting will be used).
2. The app verified in the developer portal.
3. The **"Share on LinkedIn"** product added to the app — this is self-serve and grants `w_member_social` for personal-profile posting. No approval wait for this part.
4. **Separately:** confirm whether **Marketing Developer Platform (MDP)** approval has been applied for or granted yet, for `w_organization_social` (Company Page posting). This is a manual LinkedIn review that can take days to over a month. **Do not wait for this before starting Step 1** — personal-profile posting doesn't need it. **Do not attempt Step 3 (Company Page posting) until the user explicitly confirms MDP approval has been granted** — building against `w_organization_social` before approval will simply fail at the API level and waste effort.
5. OAuth 2.0 redirect URI configured, matching this project's callback route.
6. Environment variables present:
```
LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...
LINKEDIN_REDIRECT_URI=...
```
`LINKEDIN_CLIENT_SECRET` is backend-only, exactly like every other platform credential in this project.

---

## 3. Operating Protocol — CRITICAL, follow exactly every step, no exceptions

For **every step** listed in Section 7, follow this exact loop. Do not shortcut it, do not combine steps, do not skip Step 5.

### Step 1 of the loop — Build
Implement only what is in scope for the current step's numbered instructions in Section 7. Do not implement a later step early. Do not skip part of the current step.

### Step 2 of the loop — Self-check (mandatory before reporting anything as done)
- Run the linter and the type-checker on all changed/new code.
- Run the full automated test suite.
- Boot the affected service(s) and manually test the actual flow with a real LinkedIn test account — not a mock. For the OAuth step, actually complete the consent flow. For the publish step, actually confirm a real post appears on the actual LinkedIn profile (or Company Page, in Step 3) afterward.
- Confirm every outgoing LinkedIn API call includes the `Linkedin-Version` header — a missing header is an easy silent mistake to make and should be caught here, not in production.
- If the step touched a Supabase table: confirm RLS is enabled and actually attempt cross-user access as a second test user to confirm it's blocked.
- Actively search for: broken imports, unhandled promise rejections/exceptions, missing environment variables, failing API calls, console/runtime errors, type errors, dead code, and anything that duplicates logic that already exists for other platforms instead of extending it.

### Step 3 of the loop — Fix
Fix every issue found in Step 2 before moving on. Never report a step as complete while a test is failing, the app fails to boot, or the flow you just built visibly errors out. If you find yourself fixing the same issue more than 3 times without success, **stop and report the blocker** instead of continuing to patch blindly.

### Step 4 of the loop — Report
Produce a completion report using exactly this format:

```
## LinkedIn Step [N] — [Step Name] — Complete

### What was built
- (bullet list of what was actually implemented, step by step)

### Self-check performed
- Lint: pass / fail
- Type-check: pass / fail
- Tests: X passed / Y failed
- RLS cross-user test (if applicable): pass / fail / not applicable
- Manual smoke test: (what you actually did with a real LinkedIn account, and what happened)

### Issues found & fixed
- (bullet list, or "None found")

### Known limitations / intentionally deferred
- (bullet list, or "None")

### Waiting for your approval to start Step [N+1] — [Next Step Name]
```

Before Step 3 specifically, the report must also explicitly ask the user to confirm MDP approval has actually been granted — do not treat a general "go ahead" as covering that confirmation.

### Step 5 of the loop — STOP and wait for explicit approval
Do not write, generate, or scaffold **any** code for the next step. Wait for the user to explicitly say something like "go ahead," "approved," "start step [N+1]," or "yes continue."

- If the user gives feedback or asks for changes instead, apply them, repeat Step 2 (self-check) and Step 3 (fix), and produce an **updated** completion report for the same step — still without starting the next step.
- If the user asks a question, answer it in place without starting new code.

**You must never:**
- Auto-start the next step right after finishing the current one.
- Mark a step complete while it has failing tests, a broken build, an untested flow, or a missing `Linkedin-Version` header.
- Silently drop a numbered instruction and still call the step "done."
- Build a duplicate OAuth system, adapter interface, or state machine — extend the existing ones.
- Attempt Step 3 (Company Page posting) without the user's explicit confirmation that MDP approval has been granted — a general "go ahead" between steps is not sufficient for this specific step.
- Do the steps in Section 7 out of order.

---

## 4. Engineering Rules for This Addition

- Encrypt LinkedIn's `access_token` and `refresh_token` at the application level before storing — same as every other platform.
- Never expose `LINKEDIN_CLIENT_SECRET` or the Supabase service role key to the frontend.
- Send the `Linkedin-Version` header on every LinkedIn API call, pinned via configuration rather than hardcoded inline in multiple places.
- The adapter you write must match the existing adapter interface shape (`prepareMedia`, `publish`, `getStatus`) exactly.
- Map LinkedIn's outcomes onto the existing state machine — do not invent a LinkedIn-only status value.
- All new Supabase tables/columns get RLS/ownership handling consistent with the existing `user_id = auth.uid()` pattern.
- All schema changes are versioned Supabase CLI migrations.

---

## 5. Working Logic — What's Actually Different About LinkedIn (read before Step 1)

1. **Two distinct posting targets, gated completely differently.** Personal profile (`w_member_social`) is self-serve, works immediately. Company Page (`w_organization_social`) requires LinkedIn's manual Marketing Developer Platform review, plus the connected user having an admin-level role on that specific page. Design `social_accounts` so a row can represent either a `'member'` or `'organization'` target type from the start, even though only `'member'` is built in Step 1 — this avoids a schema rework in Step 3.

2. **Every API call needs a `Linkedin-Version` header** (format `YYYYMM`). This is unlike every other platform connected so far, which version via the URL path or don't version per-request at all. Pin the version in configuration.

3. **Refresh tokens have a hard 365-day ceiling — genuinely different from every other platform in this codebase.** Access tokens expire every 60 days and are refreshed using the refresh token up until that point, but the refresh token itself stops working at 365 days no matter what — there is no rolling renewal like Facebook's or Pinterest's. Build a proactive check: flag any LinkedIn connection within 30 days of its 365-day ceiling and surface a "reconnect LinkedIn" prompt in the dashboard, rather than letting the connection silently die and only being discovered when a scheduled publish fails.

4. **No native scheduling exists on LinkedIn's API at all.** There's no `scheduled_at`-style parameter to misuse (unlike Pinterest). The existing "Scheduling Service decides when, adapter publishes now" pattern applies here with zero special-casing — this is the simplest platform so far in that specific respect.

5. **Media upload is a two-step reference pattern.** Upload via `/rest/images` or `/rest/videos` (video is chunked, tracked via `ETag`) to get a URN back, then reference that URN when creating the post via `POST /rest/posts` — similar in shape to YouTube's and Pinterest's upload-then-reference pattern.

6. **Rate limits are roughly 100–150 calls/day per connected member** for the Share on LinkedIn product — confirm the current number from LinkedIn's own product page when implementing, as it's occasionally adjusted. Worth tracking per-account, similar in spirit to YouTube's and Pinterest's per-account limits.

7. **Supported content types via the Posts API: text, images, video, and article/link shares.** Polls are not supported via the API — do not build a UI affordance implying they are.

---

## 6. Database Changes (Supabase migration)

- `social_accounts`: extend the `platform` check constraint to allow `'linkedin'`. Add nullable `target_type text` (`'member'` / `'organization'`) and nullable `organization_urn text` (populated only once Step 3 is built). Add nullable `refresh_token_expires_at timestamptz` to support the 365-day ceiling check from Working Logic point 3.
- `media_variants`: no schema change — a LinkedIn variant is just another row with `platform = 'linkedin'`.

---

## 7. Build Steps (in this exact order — do not reorder, merge, or skip ahead)

### Step 1 — LinkedIn OAuth Connect, Personal Profile (extends Account Service)

1. Build the LinkedIn authorization URL with scopes `openid profile w_member_social` (add `email` if useful for display).
2. Handle the callback, exchange the code for `access_token` + `refresh_token`.
3. Encrypt both, insert into `social_accounts` with `platform = 'linkedin'`, `target_type = 'member'`, and `refresh_token_expires_at` set to 365 days from now.
4. Implement 60-day access-token refresh using the refresh token, and implement the proactive reconnect-warning check for the 365-day ceiling (Working Logic point 3) — surface it as a dashboard notification/flag when a connection is within 30 days of expiry.
5. Frontend: add a "Connect LinkedIn" button alongside the existing platform buttons.

**Definition of done for this step:** a real user connects their personal LinkedIn profile via OAuth, verifiable directly in `social_accounts` with correct token expiry tracking.

### Step 2 — Media Variant + LinkedIn Adapter (extends Media Service and Publishing Service)

1. Add a LinkedIn case to the existing variant-generation function — confirm current LinkedIn image/video size and format limits directly from LinkedIn's docs rather than assuming they match another platform; a reasonable default ratio (e.g. 1.91:1) is acceptable if LinkedIn doesn't enforce a strict ratio.
2. Implement the LinkedIn adapter (`prepareMedia()`, `publish()`, `getStatus()`) matching the existing interface shape: upload media via `/rest/images` or `/rest/videos` to get a URN, then `POST /rest/posts` with the member's URN as author, the pinned `Linkedin-Version` header, and the media reference — no scheduling parameter is sent (per Working Logic point 4).
3. Wire into the existing per-platform worker/fan-out pattern.

**Definition of done for this step:** scheduling a post that includes LinkedIn among its targets results in a real post appearing on the connected personal profile at the actual scheduled time (confirm your own queue controls the timing, since LinkedIn has no native scheduling to lean on); a deliberately-broken publish (e.g. invalid token) retries and then lands on `Failed` with a clear error, without affecting a simultaneous publish to any other platform for the same post.

### Step 3 — LinkedIn OAuth + Adapter Extension, Company Page (only after the user explicitly confirms MDP approval is granted)

1. Confirm with the user that MDP approval has been granted before writing any code for this step, per Section 3.
2. Extend the OAuth scope request to include `w_organization_social` + `r_organization_social`.
3. After connecting, list the Company Pages the member administers and let them select one; store as a `social_accounts` row with `target_type = 'organization'` and the resolved `organization_urn`.
4. Extend the adapter's `publish()` so that when the target account's `target_type` is `'organization'`, the post is authored with the organization's URN instead of the member's — reuse the same underlying `/rest/posts` call, just a different `author` field, not a separate method.

**Definition of done for this step:** a real post appears on the connected Company Page, verified directly on LinkedIn, published through the SocialPush integration.

### Step 4 (optional) — LinkedIn Analytics

1. Extend the Analytics Service to pull whatever post-level metrics are actually available under the approved LinkedIn product — confirm what's accessible before committing to specific metrics in the dashboard UI, since LinkedIn's available analytics are more limited than Meta's or YouTube's.
2. Write results into the existing `analytics` table with `platform = 'linkedin'`.

---

## 8. First Action

Start with **Step 1 only**. When Step 1's self-check (Section 3, loop Step 2) passes cleanly with a real connected LinkedIn personal profile and correct token-expiry tracking, produce the Step 1 completion report and then stop and wait for approval before touching Step 2, exactly as Section 3 requires. Do not proceed to Step 2 under any circumstances until the user explicitly approves, and do not proceed to Step 3 under any circumstances until the user explicitly confirms MDP approval has been granted, in addition to approving the step itself.
