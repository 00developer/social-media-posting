import { Ratelimit } from '@upstash/ratelimit';
import { upstashRedis } from './upstash';

// Create a new ratelimiter, that allows 5 requests per 1 minute
export const publishRateLimiter = upstashRedis
  ? new Ratelimit({
      redis: upstashRedis,
      limiter: Ratelimit.slidingWindow(5, '60 s'),
      analytics: true,
      prefix: '@upstash/ratelimit',
    })
  : null;
