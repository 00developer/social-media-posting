# SocialPush 🚀

SocialPush is a unified, multi-platform social media management and publishing tool. It allows individuals, creators, and teams to schedule, publish, and track content across all major social networks from a single intuitive dashboard.

## 🌟 Supported Platforms
- **Facebook** (Pages)
- **Instagram** (Posts & Reels)
- **Twitter / X**
- **LinkedIn** (Profiles & Pages)
- **YouTube** (Videos & Shorts)
- **TikTok** (Videos)
- **Pinterest** (Pins & Video Pins)

## ✨ Core Features
- **Write Once, Publish Everywhere:** Compose a single post and distribute it across selected platforms simultaneously.
- **Smart Media Handling:** Automatic image and video resizing/cropping to fit the aspect ratio constraints of each platform (e.g., 1000x1500 for Pinterest, 9:16 for Reels/Shorts).
- **Advanced Scheduling:** Schedule posts for future dates using a robust distributed queuing system (Redis + BullMQ).
- **Unified Analytics:** Track Views, Likes, and Shares across all platforms in a centralized timeline.
- **Team Collaboration:** Invite members to your team with specific roles (Owner, Admin, Editor, Viewer).
- **Drafts & Previews:** Preview exactly how your post will look on each platform before hitting publish.

## 🏗️ Architecture & Tech Stack
SocialPush is built as a highly scalable monorepo.

- **Frontend:** Next.js 15, React 19, Tailwind CSS, TypeScript
- **Backend Services:** Node.js, Express, TypeScript (Microservices architecture)
- **Database & Auth:** Supabase (PostgreSQL, Row Level Security, Auth)
- **Message Queue:** Redis & BullMQ (for delayed scheduling and heavy background tasks)
- **Infrastructure:** Docker & Kubernetes (Ready for scalable cloud deployment)

### Microservices Breakdown:
- `account-service`: Handles OAuth flows and stores encrypted tokens for social platforms.
- `post-service`: Manages post creation, drafts, and team billing limits.
- `publishing-service`: Contains platform-specific adapters (Twitter, Facebook, YouTube, etc.) to securely post content via native APIs.
- `media-service`: Processes, resizes, and optimizes images and videos before publishing.
- `scheduling-service`: Manages future posts using BullMQ.
- `analytics-service`: Background worker that periodically syncs analytics data from platforms.

## 🚀 Getting Started (Local Development)

### Prerequisites
- Node.js (v18+)
- Docker & Docker Compose (for local Redis/Postgres, optional if using cloud Supabase/Upstash)
- Supabase CLI

### Setup
1. Clone the repository:
   ```bash
   git clone https://github.com/00developer/social_media_posting.git
   cd social-media-posting
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up Environment Variables:
   Copy `.env.example` to `.env` and fill in your Supabase keys and Social API credentials.
4. Run the development server:
   ```bash
   npm run dev:all
   ```
5. Open `http://localhost:3000` to access the dashboard.

## 🛡️ Security
All OAuth tokens and sensitive API keys are encrypted at the application level before being stored in the database. Row Level Security (RLS) ensures complete data isolation between different teams and users.

---
*Built for creators, by creators.*
