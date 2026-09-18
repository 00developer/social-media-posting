"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCachedTeamRole = getCachedTeamRole;
exports.setCachedTeamRole = setCachedTeamRole;
const upstash_1 = require("./upstash");
const CACHE_TTL_SECONDS = 300; // 5 minutes default
/**
 * Gets a user's cached role for a specific team
 */
async function getCachedTeamRole(teamId, userId) {
    if (!upstash_1.upstashRedis)
        return null;
    try {
        const role = await upstash_1.upstashRedis.get(`team_role:${teamId}:${userId}`);
        return role;
    }
    catch (err) {
        console.error('Redis get error:', err);
        return null;
    }
}
/**
 * Sets a user's role for a specific team in the cache with a TTL
 */
async function setCachedTeamRole(teamId, userId, role, ttlSeconds = CACHE_TTL_SECONDS) {
    if (!upstash_1.upstashRedis)
        return;
    try {
        await upstash_1.upstashRedis.set(`team_role:${teamId}:${userId}`, role, { ex: ttlSeconds });
    }
    catch (err) {
        console.error('Redis set error:', err);
    }
}
