# Threads Integration — Progress Report

This document records the exact state of the Threads Integration as of our current progress in Step 1.

## What Has Been Implemented (Step 1 - Partially Complete)

1. **Database Migration**
   - **Action:** Created migration file `supabase/migrations/20260919000001_threads_schema.sql`.
   - **Result:** Drops and recreates the `social_accounts_platform_check` constraint to allow the `'threads'` platform.
   - **Status:** *Pending application* (Needs `npx supabase migration up`).

2. **Account Service Backend**
   - **Action:** Updated `services/account-service/src/index.ts`.
   - **Result:** 
     - Added OAuth URL generation for Threads requesting `threads_basic,threads_content_publish` scopes.
     - Added Threads to the callback handler to perform the long-lived token exchange and encrypt the token (sharing Meta's standard logic).
   - **Status:** Code written, pending testing.

3. **Frontend Dashboard UI**
   - **Action:** Updated `apps/web/src/app/dashboard/accounts/page.tsx`.
   - **Result:** Added "threads" to the platform list so the "Connect Threads" button appears on the Accounts page.
   - **Status:** Code written.

## What Is Pending (Immediate Next Steps)

1. **Meta Developer Portal Setup (USER)**
   - Create a new Meta App with the "Threads API" Use Case (or configure the existing app if supported).
   - If a **new app** is created, the user needs to provide the new App ID and App Secret.
   
2. **Environment Variables & Code Adjustments**
   - If a new app is used, we need to add `THREADS_CLIENT_ID` and `THREADS_CLIENT_SECRET` to the `.env` file.
   - Adjust `account-service` to use these new environment variables instead of `FACEBOOK_APP_ID` (if applicable).

3. **Database Application**
   - Run the pending database migration.

4. **Self-Check / Testing**
   - Verify the "Connect Threads" flow end-to-end with a real Threads test account.
   - Verify the token is stored correctly in `social_accounts`.

## How to Resume

To continue, please provide the result of your Meta Developer Portal setup. If you created a new App, let me know so we can update the environment variables and backend code accordingly!
