/**
 * In-memory sliding-window rate limiter.
 * Suitable for protecting sensitive public endpoints (e.g., invite code resolution/join attempts)
 * from brute-force token enumeration.
 *
 * In multi-node/serverless deployments, this can be swapped with Redis (e.g., Upstash Redis).
 */

const DEFAULT_MAX_REQUESTS = 10;
const DEFAULT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

class RateLimiter {
  constructor() {
    this.hits = new Map();
    this.lastCleanup = Date.now();
  }

  /**
   * Check if a request identified by key is allowed.
   * @param {string} key Identifier (IP address, user ID, or combined)
   * @param {object} options
   * @param {number} options.maxRequests Maximum requests allowed within windowMs (default: 10)
   * @param {number} options.windowMs Sliding window duration in milliseconds (default: 15 minutes)
   * @returns {{ allowed: boolean, remaining: number, resetTime: number, totalHits: number }}
   */
  check(key, { maxRequests = DEFAULT_MAX_REQUESTS, windowMs = DEFAULT_WINDOW_MS } = {}) {
    const now = Date.now();

    // Periodic cleanup of expired entries
    if (now - this.lastCleanup > CLEANUP_INTERVAL_MS) {
      this.cleanup(windowMs);
      this.lastCleanup = now;
    }

    const timestamps = this.hits.get(key) || [];
    const validTimestamps = timestamps.filter(ts => now - ts < windowMs);

    if (validTimestamps.length >= maxRequests) {
      const oldestValid = validTimestamps[0];
      const resetTime = oldestValid + windowMs;
      return {
        allowed: false,
        remaining: 0,
        resetTime,
        totalHits: validTimestamps.length,
      };
    }

    validTimestamps.push(now);
    this.hits.set(key, validTimestamps);

    return {
      allowed: true,
      remaining: maxRequests - validTimestamps.length,
      resetTime: validTimestamps[0] + windowMs,
      totalHits: validTimestamps.length,
    };
  }

  /**
   * Clean up expired entries across the entire map
   */
  cleanup(windowMs = 15 * 60 * 1000) {
    const now = Date.now();
    for (const [key, timestamps] of this.hits.entries()) {
      const active = timestamps.filter(ts => now - ts < windowMs);
      if (active.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, active);
      }
    }
  }

  /**
   * Clear all recorded hits (useful in tests)
   */
  clear() {
    this.hits.clear();
  }
}

// Global singleton instance for the application runtime
const globalLimiter = new RateLimiter();

/**
 * Helper to extract client IP from Next.js request headers
 */
function getClientIp(request) {
  if (!request || !request.headers) return '127.0.0.1';
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') || '127.0.0.1';
}

module.exports = {
  RateLimiter,
  rateLimiter: globalLimiter,
  getClientIp,
  DEFAULT_MAX_REQUESTS,
  DEFAULT_WINDOW_MS,
  CLEANUP_INTERVAL_MS,
};
