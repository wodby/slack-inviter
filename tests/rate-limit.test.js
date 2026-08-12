import assert from 'node:assert/strict';
import test from 'node:test';

import { RateLimiter } from '../src/rate-limit.js';

test('rate limiter resets after its fixed window', () => {
  const limiter = new RateLimiter({ maximum: 2, windowMs: 1000 });

  assert.equal(limiter.consume('visitor', 0).allowed, true);
  assert.equal(limiter.consume('visitor', 1).allowed, true);
  assert.deepEqual(limiter.consume('visitor', 2), {
    allowed: false,
    remaining: 0,
    retryAfterSeconds: 1,
  });
  assert.equal(limiter.consume('visitor', 1000).allowed, true);
});
