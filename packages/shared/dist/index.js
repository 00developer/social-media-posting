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
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
exports.PUBLISH_QUEUE_NAME = 'publish-queue';
exports.NOTIFICATIONS_QUEUE_NAME = 'notifications-queue';
function getRedisConnection(url) {
    const isTls = url.startsWith('rediss://') || url.includes('upstash');
    return new ioredis_1.default(url, {
        maxRetriesPerRequest: null,
        ...(isTls && { tls: { rejectUnauthorized: false } })
    });
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
