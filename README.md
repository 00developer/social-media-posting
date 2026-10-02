# SocialPush 🚀

SocialPush is a multi-platform social media scheduling and publishing tool ("write once, publish everywhere"). A user (or team) connects social accounts via OAuth, composes a post with an optional image/video, picks target platforms, and either publishes immediately or schedules it for later. A background worker publishes through per-platform adapters and notifies the user of the result; analytics are pulled back periodically.



## 🌐 Platform integration

| Platform | Connect (OAuth) | Publish | Notes |
|---|---|---|---|
| Facebook (Pages) | ✅ Works (for test users, see caveat above) | ✅ Text, photo, Reel | Always uses the first Page; no page picker. |
| Instagram (Business) | ✅ Works (for test users) | ✅ Image, Reel | Same caveat; image/Reel only, no carousel. |
| YouTube | ✅ Works (for test users) | ✅ Resumable upload, Shorts tag | Most complete integration; the only one with token refresh. |
| Threads | ✅ Works (for test users) | ✅ Text/image/video | Code-complete but lightly tested with real accounts; analytics need a scope that isn't requested yet. |
| Pinterest | ✅ Works | ⚠ Likely media-URL bug on video pins | Boards import/create works; analytics work. |
| Twitter / X | ✅ Works | ⚠ Text only | No media, no analytics. |


## 🏗️ Architecture & tech stack

- **Frontend:** Next.js (App Router), React, Tailwind CSS, TypeScript, FullCalendar — `apps/web`
- **Backend:** Node.js + Express, TypeScript, microservices — one npm workspace per service under `services/`
- **Database / Auth / Storage:** Supabase (Postgres + Row Level Security + Auth + a public storage bucket for media)
- **Queue:** Redis + BullMQ (delayed scheduling, retries, background sync)
- **Media processing:** `sharp` (images), `ffmpeg` (video, per-platform aspect-ratio cropping)
