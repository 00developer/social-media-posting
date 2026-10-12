# OAuth Authentication Troubleshooting Guide

During the setup and testing of social media integrations, you may encounter authentication errors due to missing permissions in the developer platforms. This document captures the common errors seen when connecting new test accounts and their solutions.

## 1. Meta / Threads / Instagram / Facebook

**Error Encountered:**
When trying to connect a new Threads/Instagram account (e.g., `agentix_2025`), the consent popup appears and is accepted, but the backend returns an `Authentication failed` error (or `OAuthException: User not authorized`).

**Why this happens:**
If your Meta App is currently in **Development Mode**, Meta restricts OAuth access exclusively to accounts that have been explicitly added as "Test Users" (or Developers/Administrators) in the Meta App Dashboard. Attempting to authenticate with any other account will fail during the code-to-token exchange.

**How to fix:**
1. Log in to the [Meta for Developers Dashboard](https://developers.facebook.com/).
2. Select your App (e.g., `Social-thrd`).
3. In the left navigation menu, expand **App roles** and click on **Test users** (or use the **+ Add People** button under **Roles**).
4. Add the Instagram/Threads account username as a **Tester**.
5. **Crucial Step:** The status will show as **Pending**. To activate it, log into that specific Instagram/Threads account on a mobile device or web browser.
6. Navigate to **Settings and privacy -> Website permissions -> Tester Invites** (or **App Invites**).
7. Accept the invitation from your app.
8. Once the status in the Meta Dashboard changes from Pending to Active, retry the connection in your application.

---

## 2. Google / YouTube

**Error Encountered:**
When trying to connect a new YouTube account (e.g., `aiagentix2025@gmail.com`), Google immediately displays an `Error 403: access_denied` page with the message:
*"[Your App] has not completed the Google verification process. The app is currently being tested, and can only be accessed by developer-approved testers."*

**Why this happens:**
Similar to Meta, when a Google Cloud OAuth consent screen is configured with a publishing status of **Testing**, Google actively blocks any login attempt from an email address that is not on the explicitly approved "Test users" list.

**How to fix:**
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Ensure you have the correct project selected.
3. In the left navigation menu, go to **APIs & Services -> OAuth consent screen**.
   *(Note: In the newer "Google Auth Platform" UI, you will find this under **Audience**).*
4. Scroll down to the **Test users** section.
5. Click **+ Add Users** (or **Add test users**).
6. Enter the email address you are trying to connect (e.g., `aiagentix2025@gmail.com`) and click **Save**.
7. Retry the connection in your application. It should now proceed without the 403 error.
