import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider, resetProviderCapabilityCacheForTests } from '../src/provider.js';
import { ProviderScheduler } from '../src/provider-scheduler.js';

function sse(text = 'ok') {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function provider(overrides = {}) {
  return new OpenAICompatibleProvider({
    baseUrl: 'https://provider.test/v1',
    apiKey: 'shared-secret',
    model: 'm',
    scheduler: new ProviderScheduler({ maxConcurrent: 2, queueTimeoutMs: 1000 }),
    maxConcurrentRequests: 2,
    queueTimeoutMs: 1000,
    retryBaseMs: 10,
    retryMaxMs: 20,
    retryRandom: () => 0,
    ...overrides,
  });
}

test('429 honors Retry-After and succeeds without counting rate limit as circuit failure', async () => {
  resetProviderCapabilityCacheForTests();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': '0' } });
    return sse('ok');
  };
  try {
    const instance = provider({ rateLimitMaxRetries: 2, circuitFailureThreshold: 1 });
    const result = await instance.streamChat({ messages: [{ role: 'user', content: 'hello' }] });
    assert.equal(result.text, 'ok');
    assert.equal(calls, 2);
    assert.equal(result.diagnostics.rateLimitRetries, 1);
    assert.equal(result.diagnostics.retryWaitMs, 0);
    assert.deepEqual(result.diagnostics.retryAfterSources, ['seconds']);
    assert.equal(result.diagnostics.attempts[0].retryReason, 'http-429');
    assert.equal(instance.circuitState(), 'closed');
    assert.equal(instance.failureCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('429 with HTTP-date Retry-After is recognized', async () => {
  resetProviderCapabilityCacheForTests();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response('slow down', { status: 429, headers: { 'retry-after': new Date().toUTCString() } });
    return sse('ok');
  };
  try {
    const result = await provider({ rateLimitMaxRetries: 1 }).streamChat({ messages: [{ role: 'user', content: 'hello' }] });
    assert.equal(calls, 2);
    assert.deepEqual(result.diagnostics.retryAfterSources, ['date']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('429 without Retry-After uses bounded exponential backoff', async () => {
  resetProviderCapabilityCacheForTests();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response('slow down', { status: 429 });
    return sse('ok');
  };
  try {
    const result = await provider({ rateLimitMaxRetries: 1 }).streamChat({ messages: [{ role: 'user', content: 'hello' }] });
    assert.equal(calls, 2);
    assert.equal(result.diagnostics.rateLimitRetries, 1);
    assert.ok(result.diagnostics.retryWaitMs >= 1 && result.diagnostics.retryWaitMs <= 20);
    assert.deepEqual(result.diagnostics.retryAfterSources, ['backoff']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('429 after retry budget does not open the circuit', async () => {
  resetProviderCapabilityCacheForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('still limited', { status: 429 });
  try {
    const instance = provider({ rateLimitMaxRetries: 0, circuitFailureThreshold: 1 });
    await assert.rejects(
      instance.streamChat({ messages: [{ role: 'user', content: 'hello' }] }),
      (error) => error?.status === 429,
    );
    assert.equal(instance.failureCount, 0);
    assert.equal(instance.circuitState(), 'closed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('503 without Retry-After is not blindly retried and counts as an outage failure', async () => {
  resetProviderCapabilityCacheForTests();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('unavailable', { status: 503 }); };
  try {
    const instance = provider({ rateLimitMaxRetries: 2, circuitFailureThreshold: 2 });
    await assert.rejects(
      instance.streamChat({ messages: [{ role: 'user', content: 'hello' }] }),
      (error) => error?.status === 503,
    );
    assert.equal(calls, 1);
    assert.equal(instance.failureCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('503 with Retry-After can retry once and recover', async () => {
  resetProviderCapabilityCacheForTests();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return new Response('temporarily unavailable', { status: 503, headers: { 'retry-after': '0' } });
    return sse('ok');
  };
  try {
    const instance = provider({ rateLimitMaxRetries: 1, circuitFailureThreshold: 1 });
    const result = await instance.streamChat({ messages: [{ role: 'user', content: 'hello' }] });
    assert.equal(calls, 2);
    assert.equal(result.text, 'ok');
    assert.equal(result.diagnostics.rateLimitRetries, 1);
    assert.equal(instance.circuitState(), 'closed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('two provider instances with same endpoint and credential share one scheduler pool', async () => {
  resetProviderCapabilityCacheForTests();
  const originalFetch = globalThis.fetch;
  const scheduler = new ProviderScheduler({ maxConcurrent: 1, queueTimeoutMs: 1000 });
  const firstGate = deferred();
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  globalThis.fetch = async () => {
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (calls === 1) await firstGate.promise;
    active -= 1;
    return sse('ok');
  };
  try {
    const common = {
      baseUrl: 'https://provider.test/v1',
      apiKey: 'same-key',
      model: 'm',
      scheduler,
      maxConcurrentRequests: 1,
      queueTimeoutMs: 1000,
    };
    const one = new OpenAICompatibleProvider(common);
    const two = new OpenAICompatibleProvider(common);
    const first = one.streamChat({ messages: [{ role: 'user', content: 'one' }] });
    await tick();
    const second = two.streamChat({ messages: [{ role: 'user', content: 'two' }] });
    await tick();
    assert.equal(calls, 1, 'second provider must still be queued behind the shared credential pool');
    firstGate.resolve();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(a.text, 'ok');
    assert.equal(b.text, 'ok');
    assert.equal(calls, 2);
    assert.equal(maxActive, 1);
    assert.ok(b.diagnostics.queueMs >= 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
