/**
 * A small in-memory fixed-window limiter suitable for a single inviter replica.
 */
export class RateLimiter {
  constructor({ maximum, windowMs, maxEntries = 10_000 }) {
    this.maximum = maximum;
    this.windowMs = windowMs;
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  consume(key, now = Date.now()) {
    this.sweep(now);

    let entry = this.entries.get(key);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.entries.set(key, entry);
    }

    if (entry.count >= this.maximum) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      };
    }

    entry.count += 1;

    return {
      allowed: true,
      remaining: this.maximum - entry.count,
      retryAfterSeconds: 0,
    };
  }

  sweep(now) {
    if (this.entries.size < this.maxEntries) {
      return;
    }

    for (const [key, entry] of this.entries) {
      if (now >= entry.resetAt) {
        this.entries.delete(key);
      }
    }

    if (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }
}
