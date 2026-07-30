// Lightweight rate limiting for the public, unauthenticated candidate endpoints
// (/api/public/*). No external dependency — a small in-memory sliding window keyed by
// IP + route. Fine for a single-process deployment; swap for a Redis-backed limiter if you
// run multiple instances behind a load balancer.

const buckets = new Map(); // key -> [timestamps]

function rateLimit({ windowMs = 60_000, max = 20, keyPrefix = "" } = {}) {
  return (req, res, next) => {
    const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "unknown";
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    let hits = buckets.get(key) || [];
    hits = hits.filter((t) => t > windowStart);
    hits.push(now);
    buckets.set(key, hits);

    if (hits.length > max) {
      res.setHeader("Retry-After", Math.ceil(windowMs / 1000));
      return res.status(429).json({ error: "Too many requests — please wait a moment and try again." });
    }
    next();
  };
}

// Periodic cleanup so the map doesn't grow unbounded over a long-running process.
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [key, hits] of buckets.entries()) {
    const kept = hits.filter((t) => t > cutoff);
    if (kept.length) buckets.set(key, kept);
    else buckets.delete(key);
  }
}, 5 * 60_000).unref();

module.exports = { rateLimit };
