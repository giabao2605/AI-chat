import { createHash } from 'node:crypto';

function abortError(message = 'Provider request aborted.') {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function queueTimeoutError(timeoutMs) {
  const error = new Error(`Provider queue timed out after ${timeoutMs} ms.`);
  error.code = 'PROVIDER_QUEUE_TIMEOUT';
  return error;
}

function positiveInt(value, fallback) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export function providerSchedulerDefaultsFromEnv(env = process.env) {
  return {
    maxConcurrent: positiveInt(env.PROVIDER_MAX_CONCURRENT_REQUESTS, 3),
    queueTimeoutMs: Math.max(0, positiveInt(env.PROVIDER_QUEUE_TIMEOUT_MS, 60000)),
  };
}

export function providerRetryDefaultsFromEnv(env = process.env) {
  return {
    maxRetries: Math.max(0, Math.min(8, positiveInt(env.PROVIDER_RATE_LIMIT_MAX_RETRIES, 2))),
    baseMs: Math.max(10, positiveInt(env.PROVIDER_RETRY_BASE_MS, 500)),
    maxMs: Math.max(10, positiveInt(env.PROVIDER_RETRY_MAX_MS, 8000)),
  };
}

export function providerPoolKey(endpoint, apiKey) {
  const normalizedEndpoint = String(endpoint || '').trim().replace(/\/+$/, '').toLowerCase();
  const fingerprint = createHash('sha256').update(String(apiKey || '')).digest('hex').slice(0, 20);
  return `${normalizedEndpoint}::${fingerprint}`;
}

export function parseRetryAfter(value, now = Date.now()) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isFinite(seconds) && seconds >= 0
      ? { delayMs: Math.ceil(seconds * 1000), source: 'seconds' }
      : null;
  }
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  return { delayMs: Math.max(0, at - now), source: 'date' };
}

export function exponentialBackoffMs(attempt, { baseMs = 500, maxMs = 8000, random = Math.random } = {}) {
  const base = Math.max(1, Number(baseMs) || 500);
  const max = Math.max(base, Number(maxMs) || 8000);
  const raw = Math.min(max, base * (2 ** Math.max(0, Number(attempt) || 0)));
  const jitter = 0.75 + (Math.max(0, Math.min(1, Number(random()) || 0)) * 0.5);
  return Math.max(1, Math.round(Math.min(max, raw * jitter)));
}

export async function abortableDelay(ms, signal) {
  const delay = Math.max(0, Math.floor(Number(ms) || 0));
  if (!delay) {
    if (signal?.aborted) throw abortError();
    return;
  }
  await new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(done, delay);
    const onAbort = () => done(abortError());
    function done(error = null) {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      if (error) reject(error);
      else resolve();
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

export class ProviderScheduler {
  constructor({ maxConcurrent = 3, queueTimeoutMs = 60000 } = {}) {
    this.maxConcurrent = Math.max(0, Math.floor(Number(maxConcurrent) || 0));
    this.queueTimeoutMs = Math.max(0, Math.floor(Number(queueTimeoutMs) || 0));
    this.pools = new Map();
  }

  pool(key) {
    const normalized = String(key || 'default');
    let pool = this.pools.get(normalized);
    if (!pool) {
      pool = { active: 0, queue: [], cooldownUntil: 0, wakeTimer: null };
      this.pools.set(normalized, pool);
    }
    return pool;
  }

  setCooldown(key, delayMs) {
    const delay = Math.max(0, Math.floor(Number(delayMs) || 0));
    if (!delay) return;
    const pool = this.pool(key);
    pool.cooldownUntil = Math.max(pool.cooldownUntil, Date.now() + delay);
    this.#scheduleWake(key, pool);
  }

  async run(key, task, { signal, queueTimeoutMs = this.queueTimeoutMs, maxConcurrent = this.maxConcurrent } = {}) {
    if (typeof task !== 'function') throw new TypeError('Provider scheduler task must be a function.');
    if (signal?.aborted) throw abortError();
    const limit = Math.max(0, Math.floor(Number(maxConcurrent) || 0));
    if (limit === 0) {
      const acquiredAt = Date.now();
      return { value: await task(), queueMs: 0, concurrencyAtAcquire: null, acquiredAt };
    }

    return new Promise((resolve, reject) => {
      const pool = this.pool(key);
      const enqueuedAt = Date.now();
      const timeout = Math.max(0, Math.floor(Number(queueTimeoutMs) || 0));
      const job = {
        task,
        signal,
        limit,
        enqueuedAt,
        resolve,
        reject,
        timeoutTimer: null,
        onAbort: null,
        settled: false,
      };

      const remove = (error) => {
        if (job.settled) return;
        const index = pool.queue.indexOf(job);
        if (index >= 0) pool.queue.splice(index, 1);
        this.#cleanupJob(job);
        job.settled = true;
        reject(error);
        this.#drain(key, pool);
      };

      job.onAbort = () => remove(abortError());
      signal?.addEventListener?.('abort', job.onAbort, { once: true });
      if (timeout > 0) job.timeoutTimer = setTimeout(() => remove(queueTimeoutError(timeout)), timeout);
      pool.queue.push(job);
      this.#drain(key, pool);
    });
  }

  #cleanupJob(job) {
    if (job.timeoutTimer) clearTimeout(job.timeoutTimer);
    job.timeoutTimer = null;
    job.signal?.removeEventListener?.('abort', job.onAbort);
  }

  #scheduleWake(key, pool) {
    if (pool.wakeTimer) clearTimeout(pool.wakeTimer);
    const delay = Math.max(1, pool.cooldownUntil - Date.now());
    pool.wakeTimer = setTimeout(() => {
      pool.wakeTimer = null;
      this.#drain(key, pool);
    }, delay);
  }

  #drain(key, pool) {
    if (pool.cooldownUntil > Date.now()) {
      if (pool.queue.length) this.#scheduleWake(key, pool);
      return;
    }
    pool.cooldownUntil = 0;
    while (pool.queue.length) {
      const job = pool.queue[0];
      if (job.signal?.aborted) {
        pool.queue.shift();
        this.#cleanupJob(job);
        job.settled = true;
        job.reject(abortError());
        continue;
      }
      if (pool.active >= job.limit) return;
      pool.queue.shift();
      this.#cleanupJob(job);
      job.settled = true;
      pool.active += 1;
      const acquiredAt = Date.now();
      const concurrencyAtAcquire = pool.active;
      Promise.resolve()
        .then(job.task)
        .then(
          (value) => job.resolve({ value, queueMs: Math.max(0, acquiredAt - job.enqueuedAt), concurrencyAtAcquire, acquiredAt }),
          (error) => job.reject(error),
        )
        .finally(() => {
          pool.active = Math.max(0, pool.active - 1);
          this.#drain(key, pool);
        });
    }
  }
}

const defaults = providerSchedulerDefaultsFromEnv();
export const defaultProviderScheduler = new ProviderScheduler(defaults);
