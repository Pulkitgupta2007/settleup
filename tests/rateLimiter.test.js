const { RateLimiter, getClientIp } = require('../src/lib/rateLimiter');

describe('RateLimiter Utility', () => {
  let limiter;

  beforeEach(() => {
    limiter = new RateLimiter();
  });

  test('allows requests within maxRequests threshold', () => {
    const key = 'test-client';
    for (let i = 0; i < 5; i++) {
      const res = limiter.check(key, { maxRequests: 5, windowMs: 10000 });
      expect(res.allowed).toBe(true);
      expect(res.remaining).toBe(4 - i);
    }
  });

  test('blocks requests exceeding maxRequests threshold', () => {
    const key = 'test-client-blocked';
    for (let i = 0; i < 3; i++) {
      limiter.check(key, { maxRequests: 3, windowMs: 10000 });
    }

    const blocked = limiter.check(key, { maxRequests: 3, windowMs: 10000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetTime).toBeGreaterThan(Date.now());
  });

  test('resets counters after window expires', () => {
    const key = 'expiry-test';
    const now = Date.now();
    // Pre-populate with expired timestamp
    limiter.hits.set(key, [now - 20000]);

    const res = limiter.check(key, { maxRequests: 1, windowMs: 10000 });
    expect(res.allowed).toBe(true);
  });

  test('clear() wipes all tracked keys', () => {
    limiter.check('user-1', { maxRequests: 1, windowMs: 10000 });
    limiter.clear();
    expect(limiter.hits.size).toBe(0);
  });

  test('getClientIp parses x-forwarded-for and x-real-ip headers', () => {
    const reqWithForwarded = {
      headers: new Map([['x-forwarded-for', '198.51.100.1, 10.0.0.1']]),
    };
    expect(getClientIp(reqWithForwarded)).toBe('198.51.100.1');

    const reqWithRealIp = {
      headers: new Map([['x-real-ip', '203.0.113.19']]),
    };
    expect(getClientIp(reqWithRealIp)).toBe('203.0.113.19');

    const fallbackReq = { headers: new Map() };
    expect(getClientIp(fallbackReq)).toBe('127.0.0.1');
  });
});
