/**
 * Gets a user's cached role for a specific team
 */
export declare function getCachedTeamRole(teamId: string, userId: string): Promise<string | null>;
/**
 * Sets a user's role for a specific team in the cache with a TTL
 */
export declare function setCachedTeamRole(teamId: string, userId: string, role: string, ttlSeconds?: number): Promise<void>;
