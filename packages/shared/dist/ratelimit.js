"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishRateLimiter = void 0;
const ratelimit_1 = require("@upstash/ratelimit");
const upstash_1 = require("./upstash");
// Create a new ratelimiter, that allows 5 requests per 1 minute
exports.publishRateLimiter = upstash_1.upstashRedis
    ? new ratelimit_1.Ratelimit({
        redis: upstash_1.upstashRedis,
        limiter: ratelimit_1.Ratelimit.slidingWindow(5, '60 s'),
        analytics: true,
        prefix: '@upstash/ratelimit',
    })
    : null;
