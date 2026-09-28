/**
 * Gets a user's cached role for a specific team
 */
export declare function getCachedTeamRole(teamId: string, userId: string): Promise<string | null>;
/**
 * Sets a user's role for a specific team in the cache with a TTL
 */
export declare function setCachedTeamRole(teamId: string, userId: string, role: string, ttlSeconds?: number): Promise<void>;
/**
 * Clears a user's cached role for a team. Call this the moment a role actually changes or a member is removed -
 * without it, the old role can keep being used for up to CACHE_TTL_SECONDS (5 min) after the change, since nothing
 * else expires the cache early.
 */
export declare function deleteCachedTeamRole(teamId: string, userId: string): Promise<void>;
