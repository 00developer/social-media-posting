# Pinterest Integration — Development Document
### SocialPush — Adding Pinterest as a connected platform

**Context:** Facebook, Instagram, and YouTube are already connected and publishing successfully (Account Service, Media Service, and the Publishing Service adapter pattern are already built and proven across three platforms). This document adds **Pinterest** as the next platform, using the same overall approach — but Pinterest has a few real structural differences from every platform connected so far, called out explicitly below.

**How to use this:** Feed this document to Antigravity in the same project (it already has the codebase). It assumes the **Operating Protocol** and **Engineering Rules** from `ANTIGRAVITY_DEVELOPMENT_PROMPT.md` are still in effect (self-check after every step, fix what's broken, stop and wait for approval before the next step) — the condensed version is repeated in Section 5 so this document also works standalone.

---

## 1. Prerequisites — Pinterest Developer Setup (do this before any code)

1. Go to **developers.pinterest.com** → register as a developer → create an app.
2. You'll receive an **App ID** (`client_id`) and **App Secret** (`client_secret`) — same role as the Meta App ID/Secret and Google Client ID/Secret you already have.
3. **Important:** a new app starts in **Trial access**. In Trial, any pin or board your app creates is visible only to the app owner's own Pinterest account — it will not actually work for other real SocialPush users yet. To let real users publish visibly, you must submit the app for **Standard access** review (Pinterest's equivalent of Meta's App Review or Google's app verification). Not needed for your own testing; needed before this goes live for other users — flag this the same way the YouTube quota/verification limitation was flagged, don't discover it in production.
4. Configure an OAuth 2.0 redirect URI matching this project's callback route.

### Environment variables to add
```
PINTEREST_CLIENT_ID=...
PINTEREST_CLIENT_SECRET=...
PINTEREST_REDIRECT_URI=...
```
Backend-only, same handling as every other platform credential in this project.

---

## 2. Working Logic — What's Different About Pinterest

Read this before writing the adapter. These are the real differences from Facebook/Instagram/YouTube.

1. **Every pin requires a Board — a concept that doesn't exist on any platform you've connected so far.** `POST /v5/pins` requires a `board_id`. This is a real product decision, not just a technical detail: either let the user pick (or create) a board in the Create Post UI whenever Pinterest is a target platform, or auto-create/use a single default "SocialPush" board per connected account so there's always something to publish to. Don't silently skip this — a Pinterest job with no board to publish to has nowhere to go.

2. **Refresh tokens are on a rolling 60-day window.** Apps created since September 25, 2025 automatically receive a "continuous" refresh token: 60-day expiration, but refreshable indefinitely as long as you refresh before it lapses. This is functionally the same shape as Facebook's long-lived token handling you already built — extend that existing refresh logic rather than writing a new pattern.

3. **Pinterest supports native scheduling (`publish_at`) — do not use it.** The Pinterest API can accept a `publish_at` timestamp (10 minutes to 30 days in the future) and schedule the pin itself. Using this would mean Pinterest posts bypass your existing Scheduling Service / Redis+BullMQ engine, breaking the "Scheduling Service decides *when*, the adapter always publishes *now* when its job comes due" pattern already used for every other platform. **Do not set `publish_at`.** Call the pin-create endpoint at the scheduled time via the existing worker, exactly like Facebook/Instagram/YouTube, so every platform behaves identically from the system's point of view and the Core Working Logic stays true.

4. **Image pins and video pins are different call shapes.** An image pin can be created in a single `POST /v5/pins` call (image passed as a URL or base64). A video pin needs a separate multi-step upload through `/v5/media` first to obtain a `media_id`, which is then referenced when creating the pin — similar in shape to YouTube's upload-then-reference pattern, though lighter weight (not a full resumable/chunked protocol).

5. **Rate limits are per connected user account, not a shared pool.** Standard tier: 300 requests/minute and 1,000 write operations/day, per Pinterest account connected — not shared across all of SocialPush's users. Worth tracking per-account usage if Pinterest publishing volume grows, similar in spirit to YouTube's quota, just scoped per-user instead of per-project.

6. **Analytics only go back 90 days.** `GET /v5/pins/{pin_id}/analytics` returns data for at most 90 days back from today. The Analytics Service's periodic pull needs to run on a cadence that doesn't let any pin's performance window close unpulled.

---

## 3. Database Changes (Supabase migration)

- `social_accounts`: extend the `platform` check constraint to allow `'pinterest'`.

- **New table** `pinterest_boards` — tracks the boards available for a connected Pinterest account, since board selection is a real per-post decision here (nothing like it exists for the other platforms):
```sql
create table pinterest_boards (
  id uuid primary key default gen_random_uuid(),
  social_account_id uuid references social_accounts(id),
  user_id uuid references auth.users(id),
  pinterest_board_id text not null,
  board_name text,
  is_default boolean default false,
  created_at timestamptz default now()
);

alter table pinterest_boards enable row level security;

create policy "owner_access_only"
on pinterest_boards for all
using (user_id = auth.uid());
```

- Wherever per-platform post options already live (e.g. `publish_jobs` or an equivalent per-platform targeting record), add a nullable `pinterest_board_id` column so a scheduled Pinterest job knows which board it's publishing to — extend the existing structure, don't introduce a new one.

- `media_variants`: no schema change — a Pinterest variant is just another row with `platform = 'pinterest'`.

---

## 4. Backend Implementation — Step by Step

Build these in order. Each step gets its own self-check + approval gate (Section 5) — do not merge steps.

### Step 1 — Pinterest OAuth Connect (extends Account Service)
- Add a "Connect Pinterest" flow to `/services/account-service`: authorization URL with scopes `pins:read`, `pins:write`, `boards:read`, `boards:write`, `user_accounts:read` (add `analytics:read` too if you're building Step 4 in the same pass).
- Handle the callback, exchange the code for tokens, encrypt and store them in `social_accounts` with `platform = 'pinterest'`, same pattern as existing platforms.
- Immediately after connecting, call `GET /v5/boards` and store the returned boards in `pinterest_boards`. If the account has no boards, create a default one via `POST /v5/boards` (e.g. named "SocialPush") and mark it `is_default = true`.
- Implement refresh-token renewal on the same rolling-window logic already built for Facebook.
- Frontend: add a "Connect Pinterest" button alongside the existing platform buttons; once connected, the Create Post flow should let the user pick a board when Pinterest is a target platform (falling back to the default board if they don't pick one).

**Definition of done:** a real user can connect their Pinterest account, see their real boards listed (or a default one created for them), and this is verifiable directly in the `pinterest_boards` table — not just a "connected" badge in the UI.

### Step 2 — Media Variant Generation for Pinterest (extends Media Service)
- Add Pinterest's recommended Pin image ratio (2:3, e.g. 1000×1500) to the existing variant-generation function.
- Store the result as a `media_variants` row with `platform = 'pinterest'`.

**Definition of done:** uploading a test image produces a correctly-sized 2:3 variant, verifiable by inspecting the generated file's dimensions directly.

### Step 3 — Pinterest Adapter: `prepareMedia()` / `publish()` / `getStatus()`
- Implement the adapter in `/services/publishing-service`, matching the same interface shape used for the existing Facebook/Instagram/YouTube adapters.
- `publish()` calls `POST /v5/pins` with the required `board_id`, the prepared media, and post content — **without** a `publish_at` field, per Working Logic point 3. For video pins, complete the `/v5/media` upload first to get a `media_id` before creating the pin.
- `getStatus()`: image pins are created synchronously, so status can generally be considered final right after the call succeeds; video pins should be checked for processing completion before being marked `Published`.
- Wire into the existing per-platform worker so a Pinterest job runs as its own independent job, same fan-out logic already in place for the other platforms.

**Definition of done:** scheduling a post that includes Pinterest among its target platforms results in a real pin appearing on the correct board on the connected Pinterest account, at the scheduled time (not immediately, and not via Pinterest's own `publish_at`); a deliberately-broken publish (e.g. an invalid `board_id`) retries appropriately and then lands on `Failed` with a clear error, without affecting a simultaneous publish to any other platform for the same post.

### Step 4 (optional, after Steps 1–3 are confirmed working) — Pinterest Analytics
- Extend the existing Analytics Service to pull impressions/saves/clicks for published pins via `GET /v5/pins/{pin_id}/analytics`, mindful of the 90-day data window from Working Logic point 6.
- Write results into the existing `analytics` table with `platform = 'pinterest'` — same schema already used for other platforms, no frontend changes should be needed.

---

## 5. Operating Protocol (condensed — full version in `ANTIGRAVITY_DEVELOPMENT_PROMPT.md`)

For **each step in Section 4**:
1. **Build** only that step's scope.
2. **Self-check:** run lint + type-check + tests; boot the service and manually test the actual flow with a real Pinterest test account (connect for real, publish a real pin, confirm it appears on the correct board); confirm the RLS policy on `pinterest_boards` actually blocks a second test user from seeing the first user's boards.
3. **Fix** anything broken before calling the step done.
4. **Report**, using the same format as the main prompt:
```
## Pinterest Step [N] — [Step Name] — Complete

### What was built
### Self-check performed (lint / type-check / tests / RLS test / manual smoke test)
### Issues found & fixed
### Known limitations
### Waiting for your approval to start Step [N+1]
```
5. **STOP.** Do not start the next step until you get an explicit go-ahead, exactly as the main protocol requires.

---

## 6. Rules Specific to This Addition

- Encrypt the Pinterest access token and refresh token at the application level before storing — same as every other platform, no exceptions.
- Never call `publish()` for Pinterest without a resolved `board_id` — there is no valid "boardless" pin.
- Never set `publish_at` on a Pinterest API call — scheduling stays entirely inside the existing Scheduling Service/queue, exactly like every other platform.
- Keep the adapter interface (`prepareMedia`, `publish`, `getStatus`) identical in shape to the existing adapters.
- Don't invent a Pinterest-only post status — map Pinterest's outcomes onto the existing `Draft / Scheduled / Processing / Publishing / Published / Failed` state machine.
- RLS enabled on `pinterest_boards` in the same migration that creates it, following the existing `user_id = auth.uid()` ownership pattern.

---

*End of Pinterest Integration Development Document.*
