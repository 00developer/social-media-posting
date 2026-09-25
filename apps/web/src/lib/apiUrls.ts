// Base URLs for the backend services the browser calls directly (no API gateway in front of
// them). Each defaults to the service's local dev port so nothing changes for local development;
// set the NEXT_PUBLIC_* env var per service when deploying so the deployed frontend can reach the
// deployed backend instead of trying (and failing) to reach the visitor's own localhost.
export const ACCOUNT_SERVICE_URL = process.env.NEXT_PUBLIC_ACCOUNT_SERVICE_URL || 'http://localhost:3001';
export const POST_SERVICE_URL = process.env.NEXT_PUBLIC_POST_SERVICE_URL || 'http://localhost:3002';
export const SCHEDULING_SERVICE_URL = process.env.NEXT_PUBLIC_SCHEDULING_SERVICE_URL || 'http://localhost:3004';
export const MEDIA_SERVICE_URL = process.env.NEXT_PUBLIC_MEDIA_SERVICE_URL || 'http://localhost:3006';
export const TEAM_SERVICE_URL = process.env.NEXT_PUBLIC_TEAM_SERVICE_URL || 'http://localhost:3009';
export const ANALYTICS_SERVICE_URL = process.env.NEXT_PUBLIC_ANALYTICS_SERVICE_URL || 'http://localhost:3008';
