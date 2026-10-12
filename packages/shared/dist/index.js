"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NOTIFICATIONS_QUEUE_NAME = exports.PUBLISH_QUEUE_NAME = void 0;
exports.getRedisConnection = getRedisConnection;
exports.getQueue = getQueue;
exports.getNotificationsQueue = getNotificationsQueue;
const dns_1 = __importDefault(require("dns"));
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
// Force Node.js to resolve IPv4 addresses first.
// Prevents ENOTFOUND / ETIMEDOUT when resolving Redis Cloud hostnames on networks where IPv6 / NAT64 drops.
try {
    dns_1.default.setDefaultResultOrder?.('ipv4first');
}
catch {
    // Ignored if not supported in the running Node runtime
}
exports.PUBLISH_QUEUE_NAME = 'publish-queue';
exports.NOTIFICATIONS_QUEUE_NAME = 'notifications-queue';
function getRedisConnection(url) {
    const isTls = url.startsWith('rediss://') || url.includes('upstash');
    const redis = new ioredis_1.default(url, {
        maxRetriesPerRequest: null,
        connectTimeout: 15000,
        enableReadyCheck: false,
        retryStrategy(times) {
            // Reconnect with exponential backoff up to 3s to stay alive across Wi-Fi or DNS hiccups
            const delay = Math.min(times * 150, 3000);
            return delay;
        },
        reconnectOnError(err) {
            const targetErrors = ['READONLY', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'];
            return targetErrors.some(target => (err.message || '').includes(target));
        },
        ...(isTls && { tls: { rejectUnauthorized: false } })
    });
    redis.on('error', (err) => {
        // Avoid noisy uncaught crashes on transient network drops while ioredis reconnects in background
        const code = err?.code || '';
        const msg = err?.message || '';
        if (code === 'ECONNRESET' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || msg.includes('ENOTFOUND')) {
            return;
        }
        console.error('[Redis Client Error]', msg || err);
    });
    return redis;
}
function getQueue(connection) {
    return new bullmq_1.Queue(exports.PUBLISH_QUEUE_NAME, { connection });
}
function getNotificationsQueue(connection) {
    return new bullmq_1.Queue(exports.NOTIFICATIONS_QUEUE_NAME, { connection });
}
__exportStar(require("./upstash"), exports);
__exportStar(require("./cache"), exports);
__exportStar(require("./ratelimit"), exports);
__exportStar(require("./auth"), exports);
__exportStar(require("./secrets"), exports);
