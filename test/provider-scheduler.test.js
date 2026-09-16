import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderScheduler,
  exponentialBackoffMs,
  parseRetryAfter,
  providerPoolKey,
} from '../src/provider-scheduler.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('scheduler caps concurrency and starts queued work FIFO', async () => {
  const scheduler = new ProviderScheduler({ maxConcurrent: 2, queueTimeoutMs: 1000 });
  const gates = [deferred(), deferred(), deferred(), deferred()];
  const started = [];
  let active = 0;
  let maxActive = 0;

  const jobs = gates.map((gate, index) => scheduler.run('shared', async () => {
    started.push(index);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await gate.promise;
    active -= 1;
    return index;
  }));

  await tick();
  assert.deepEqual(started, [0, 1]);
  assert.equal(maxActive, 2);

  gates[0].resolve();
  await tick();
  assert.deepEqual(started, [0, 1, 2]);
  gates[1].resolve();
  await tick();
  assert.deepEqual(started, [0, 1, 2, 3]);

  gates[2].resolve();
  gates[3].resolve();
  const results = await Promise.all(jobs);
  assert.deepEqual(results.map((item) => item.value), [0, 1, 2, 3]);
  assert.ok(results[2].queueMs >= 0);
  assert.ok(results.every((item) => item.concurrencyAtAcquire <= 2));
});

test('aborted queued work is removed and never executes', async () => {
  const scheduler = new ProviderScheduler({ maxConcurrent: 1, queueTimeoutMs: 1000 });
  const gate = deferred();
  const first = scheduler.run('shared', () => gate.promise);
  const controller = new AbortController();
  let ran = false;
  const queued = scheduler.run('shared', async () => { ran = true; }, { signal: controller.signal });
  await tick();
  controller.abort();
  await assert.rejects(queued, (error) => error?.name === 'AbortError');
  gate.resolve('done');
  await first;
  await tick();
  assert.equal(ran, false);
});

test('queue timeout is separate from provider execution timeout', async () => {
  const scheduler = new ProviderScheduler({ maxConcurrent: 1, queueTimeoutMs: 20 });
  const gate = deferred();
  const first = scheduler.run('shared', () => gate.promise);
  const queued = scheduler.run('shared', async () => 'never', { queueTimeoutMs: 20 });
  await assert.rejects(queued, (error) => error?.code === 'PROVIDER_QUEUE_TIMEOUT');
  gate.resolve('done');
  await first;
});

test('different credential pools do not block each other', async () => {
  const scheduler = new ProviderScheduler({ maxConcurrent: 1, queueTimeoutMs: 1000 });
  const gate = deferred();
  const first = scheduler.run('credential-a', () => gate.promise);
  let secondRan = false;
  const second = scheduler.run('credential-b', async () => { secondRan = true; return 'b'; });
  await tick();
  assert.equal(secondRan, true);
  assert.equal((await second).value, 'b');
  gate.resolve('a');
  await first;
});

test('pool key groups same endpoint and credential without exposing the raw key', () => {
  const one = providerPoolKey('https://provider.test/v1/', 'super-secret-key');
  const two = providerPoolKey('https://provider.test/v1', 'super-secret-key');
  const other = providerPoolKey('https://provider.test/v1', 'different-key');
  assert.equal(one, two);
  assert.notEqual(one, other);
  assert.equal(one.includes('super-secret-key'), false);
});

test('Retry-After parses seconds and HTTP dates while backoff stays bounded', () => {
  assert.deepEqual(parseRetryAfter('1.5', 0), { delayMs: 1500, source: 'seconds' });
  assert.deepEqual(parseRetryAfter('Thu, 01 Jan 1970 00:00:02 GMT', 1000), { delayMs: 1000, source: 'date' });
  assert.equal(parseRetryAfter('nonsense'), null);

  const low = exponentialBackoffMs(0, { baseMs: 100, maxMs: 1000, random: () => 0 });
  const high = exponentialBackoffMs(10, { baseMs: 100, maxMs: 1000, random: () => 1 });
  assert.equal(low, 75);
  assert.equal(high, 1000);
});
