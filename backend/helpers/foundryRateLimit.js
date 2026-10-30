const { getCurrentRequestLogger } = require('../loggerContext');

/**
 * 429 handling for calls to the Foundry gpt-4.1 deployment.
 *
 * Every chat-completions caller in this app -- SDR/NJISP extraction, the AI
 * Companion agent loop, case-note guidance -- shares ONE Azure deployment with
 * a single tokens-per-minute budget. Azure's own limiter is the enforcement
 * point; this module exists to make being limited survivable rather than to
 * pre-empt it. Requests are not queued or capped here: they go out as they
 * arrive, and Azure decides.
 *
 * What it does provide is a shared cooldown. When any caller is told 429, the
 * quota window is spent for everyone, not just that caller -- so every caller
 * waits out the Retry-After the service asked for before trying again. Backing
 * off individually would just walk the other callers into the same wall.
 *
 * The wait carries jitter, because the cooldown ends at one shared instant and
 * without it every blocked caller would fire at the same millisecond, trip the
 * fresh window together, and re-synchronise on a new cooldown.
 *
 * None of this makes an oversized request fit. A single document larger than
 * the per-minute budget is refused on arrival however long you wait; that needs
 * either more quota or a smaller request.
 */

const RATE_LIMIT_STATUSES = new Set([429, 503]);

const DEFAULT_MAX_ATTEMPTS = 3;
const FALLBACK_RETRY_WAIT_SECONDS = 30;
const MIN_RETRY_WAIT_SECONDS = 1;
const MAX_RETRY_WAIT_SECONDS = 60;

// Spread added to the end of a shared cooldown so callers released by the same
// deadline do not all fire on the same millisecond.
const COOLDOWN_JITTER_MS = 2000;

/** Raised by a call site when Foundry answers 429/503. */
class FoundryRateLimitError extends Error {
  constructor(status, retryAfterSeconds) {
    super(`Foundry rate limit (HTTP ${status})`);
    this.name = 'FoundryRateLimitError';
    this.status = status;
    this.retryAfterSeconds = clampRetryWait(retryAfterSeconds);
  }
}

function clampRetryWait(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return FALLBACK_RETRY_WAIT_SECONDS;
  return Math.min(Math.max(value, MIN_RETRY_WAIT_SECONDS), MAX_RETRY_WAIT_SECONDS);
}

/**
 * Reads Retry-After off a response, from either a fetch `Headers` object or the
 * plain object axios exposes.
 *
 * Azure sends `retry-after` in seconds and a `retry-after-ms` that is often 0,
 * so the seconds header wins and a zero is ignored rather than treated as
 * "retry immediately".
 *
 * @param {Headers|Record<string, string>|undefined} headers
 * @returns {number|null} seconds, or null when the service did not say
 */
function retryAfterFromHeaders(headers) {
  if (!headers) return null;

  const read = typeof headers.get === 'function'
    ? (key) => headers.get(key)
    : (key) => headers[key] ?? headers[key.toLowerCase()];

  const seconds = Number(read('retry-after'));
  if (Number.isFinite(seconds) && seconds > 0) return seconds;

  const ms = Number(read('retry-after-ms'));
  if (Number.isFinite(ms) && ms > 0) return ms / 1000;

  return null;
}

/**
 * What a user is told when the deployment turns us away. Deliberately says
 * nothing about tokens, quotas or Azure: from where they sit, the service is
 * busy and a retry shortly is the right thing to do.
 */
const RATE_LIMITED_USER_MESSAGE = 'The AI service is busy right now. Please try again in a minute.';

/**
 * Sends the one response shape every Foundry-backed endpoint uses for a rate
 * limit, so callers get a real reason instead of a generic 500 they cannot act
 * on. Kept here rather than repeated per handler: the status, the Retry-After
 * header and the body keys should not drift apart between endpoints.
 *
 * @param {object} res - Express response
 * @param {FoundryRateLimitError} error
 * @param {string} [message] - endpoint-specific wording; defaults to the generic one
 */
function sendRateLimitResponse(res, error, message = RATE_LIMITED_USER_MESSAGE) {
  res.set('Retry-After', String(error.retryAfterSeconds));
  return res.status(503).json({
    message,
    error: 'RATE_LIMITED',
    retryAfterSeconds: error.retryAfterSeconds,
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let cooldownUntilMs = 0;

async function waitOutCooldown(label) {
  const remainingMs = cooldownUntilMs - Date.now();
  if (remainingMs <= 0) return;

  const jitterMs = Math.floor(Math.random() * COOLDOWN_JITTER_MS);
  getCurrentRequestLogger().info(
    { label, waitMs: remainingMs, jitterMs },
    'runFoundryRequest: Holding off, deployment is in a rate-limit cooldown',
  );
  await sleep(remainingMs + jitterMs);
}

/**
 * Runs one Foundry request, retrying on 429/503.
 *
 * `fn` must throw FoundryRateLimitError when the service rate-limits it --
 * detection lives at the call site because fetch and axios report it
 * differently. Anything else it throws propagates untouched on the first throw.
 *
 * @param {() => Promise<T>} fn
 * @param {{label?: string, maxAttempts?: number}} [options]
 * @returns {Promise<T>}
 * @template T
 */
async function runFoundryRequest(fn, { label = 'foundry', maxAttempts = DEFAULT_MAX_ATTEMPTS } = {}) {
  const log = getCurrentRequestLogger();
  let lastRateLimitError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await waitOutCooldown(label);

    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof FoundryRateLimitError)) throw err;

      lastRateLimitError = err;
      // Hold every caller back, not just this one: the budget is shared, so a
      // 429 here means the next request from anywhere would meet the same wall.
      cooldownUntilMs = Math.max(cooldownUntilMs, Date.now() + err.retryAfterSeconds * 1000);

      log.warn(
        { label, attempt, maxAttempts, status: err.status, retryAfterSeconds: err.retryAfterSeconds },
        'runFoundryRequest: Foundry rate limited the request',
      );
    }
  }

  log.error({ label, maxAttempts }, 'runFoundryRequest: Giving up after repeated rate limits');
  throw lastRateLimitError;
}

/** Test seam: clears cooldown state between cases. */
function __resetForTests() {
  cooldownUntilMs = 0;
}

module.exports = {
  RATE_LIMIT_STATUSES,
  RATE_LIMITED_USER_MESSAGE,
  FoundryRateLimitError,
  retryAfterFromHeaders,
  sendRateLimitResponse,
  runFoundryRequest,
  __resetForTests,
};
