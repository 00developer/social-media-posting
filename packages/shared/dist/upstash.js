"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upstashRedis = void 0;
const redis_1 = require("@upstash/redis");
// Only initialize if the environment variables are present
exports.upstashRedis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new redis_1.Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
    : null;
