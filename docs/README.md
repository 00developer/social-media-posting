# SocialPush — Handover Documentation

Written from a read-only audit of the repository (branch `master`, HEAD `90d94d6`, plus the uncommitted working tree as of 2026-09-21). Where these docs and older planning docs disagree, **these docs follow the code**.

> **Continuing the Calendar work? Start with [RESUME_HERE.md](RESUME_HERE.md)** — current status, exact next step, live test data, gotchas, commands.

| Doc | What it answers |
|---|---|
| [RESUME_HERE.md](RESUME_HERE.md) | **Handover for the Calendar feature (Steps 1–3): where we stopped, what to do next, how we work** |
| [CALENDAR_STEP2_BASELINE.md](CALENDAR_STEP2_BASELINE.md), [CALENDAR_STEP3_BASELINE.md](CALENDAR_STEP3_BASELINE.md) | Baselines, decisions, invariants and manual checklists for Calendar Steps 2 and 3 |
| [dev-scripts/](dev-scripts/README.md) | Queue / snapshot / re-queue / HTTP-test helper scripts |
| [archive/](archive/) | The previous agent's original project progress report |
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | What the product is, stack, how to run it, repo layout at a glance |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Services, ports, frontend/back-end structure, coupling, safe vs. dangerous areas |
| [SYSTEM_FLOW.md](SYSTEM_FLOW.md) | Step-by-step runtime flows (login, connect account, publish, schedule, analytics) |
| [DATABASE.md](DATABASE.md) | Tables, columns, RLS, migrations, and **schema drift** vs. what the code uses |
| [API_MAP.md](API_MAP.md) | Every HTTP endpoint, queue, and worker |
| [BUSINESS_LOGIC.md](BUSINESS_LOGIC.md) | Roles, billing limits, status machine, per-platform rules |
| [INTEGRATIONS.md](INTEGRATIONS.md) | Per-platform status (real vs. mock), scopes, quirks |
| [CURRENT_STATE.md](CURRENT_STATE.md) | Honest snapshot: what works, what is half-done, working-tree state |
| [COMPLETED_WORK.md](COMPLETED_WORK.md) | Features that exist in code |
| [PENDING_WORK.md](PENDING_WORK.md) | Planned and missing work, prioritised |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | Bugs, security gaps, technical debt (with file references) |
| [DECISIONS.md](DECISIONS.md) | Architectural decisions found in the code, and why they matter |
| [FILE_MAP.md](FILE_MAP.md) | Every important file, what it does, how risky it is to touch |

## Read this first (the five things that will bite you)

1. **There is no real authentication on the backend.** Services trust `userId`/`teamId` sent by the browser. See KNOWN_ISSUES #1.
2. **The frontend hardcodes `http://localhost:30xx`** for every backend call, so only the Next.js app can be deployed (Vercel); the services only work on the developer's machine.
3. **The code uses DB columns that no migration creates** (`social_accounts.provider_account_id`, `handle`, `status`; `posts.media_variants`). The live Supabase DB may differ from `supabase/migrations/`. Reconcile before trusting the schema docs.
4. **"Retry" does not exist at the queue level.** Jobs are added to BullMQ without `attempts`, so the worker's retry logic never gets a second try. See KNOWN_ISSUES #6.
5. **Several integrations are partly mock** (TikTok entirely; LinkedIn OAuth callback; Twitter media). See INTEGRATIONS.md.

## How this project was built (context)

The project was developed by another coding agent (Antigravity) working from step-by-step prompt documents ("Operating Protocol": build one step → self-check → report → **stop and wait for approval**). The prompt documents for Calendar (`imple/`) and Threads (`thread/`) are untracked in the repo; the earlier ones (Blueprint, LinkedIn, Pinterest, YouTube, Reels) are tracked in git but **deleted in the working tree** — recover with `git show HEAD:<path>` if needed. Progress reports (`PROGRESS_REPORT.md` = Calendar, `THREADS_PROGRESS_REPORT.md` = Threads) are partly **out of date** relative to the code (see CURRENT_STATE.md).
