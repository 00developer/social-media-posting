import { upstashRedis } from './upstash';

const CACHE_TTL_SECONDS = 300; // 5 minutes default

/**
 * Gets a user's cached role for a specific team
 */
export async function getCachedTeamRole(teamId: string, userId: string): Promise<string | null> {
  if (!upstashRedis) return null;
  try {
    const role = await upstashRedis.get<string>(`team_role:${teamId}:${userId}`);
    return role;
  } catch (err) {
    console.error('Redis get error:', err);
    return null;
  }
}

/**
 * Sets a user's role for a specific team in the cache with a TTL
 */
export async function setCachedTeamRole(teamId: string, userId: string, role: string, ttlSeconds = CACHE_TTL_SECONDS): Promise<void> {
  if (!upstashRedis) return;
  try {
    await upstashRedis.set(`team_role:${teamId}:${userId}`, role, { ex: ttlSeconds });
  } catch (err) {
    console.error('Redis set error:', err);
  }
}
