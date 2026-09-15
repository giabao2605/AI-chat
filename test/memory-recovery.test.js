import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryProfiledRoom } from '../src/memory-profiled-room.js';
import { SqliteMemoryStore } from '../src/memory-store.js';

function usage() {
  return { inputTokens: 1, outputTokens: 1, totalTokens: 2, exact: true };
}

function agents() {
  return {
    a: { id: 'a', name: 'Luna 1', apiKey: 'a', model: 'mock', baseUrl: 'http://mock' },
    b: { id: 'b', name: 'Luna 2', apiKey: 'b', model: 'mock', baseUrl: 'http://mock' },
  };
}

function providerFactory() {
  return {
    async streamChat() {
      return { text: 'ok', usage: usage(), toolCalls: [] };
    },
  };
}

test('failed consolidation keeps the same history batch retryable', async () => {
  let fail = true;
  const calls = [];
  const memory = {
    enabled: true,
    scope: 'agent',
    stats: () => ({ total: 0, byType: {} }),
    shouldConsolidate: (count, { force = false } = {}) => force ? count > 0 : count >= 1,
    async consolidate({ agentId, events }) {
      calls.push({ agentId, eventIds: events.map((event) => event.id) });
      if (fail) throw new Error('temporary memory provider failure');
      return { stored: [], usage: usage(), skipped: false };
    },
  };

  const room = new MemoryProfiledRoom({
    roomId: 'default-room',
    memoryManager: memory,
    agents: agents(),
    providerFactory,
  });
  room.createProviders();
  room.runId = 'run-retry';
  room.topic = 'retry test';
  room.history = [{ id: 'm1', speaker: 'user', name: 'Bạn', text: 'Remember this.' }];

  await room.queueMemoryConsolidation('a', { force: true });

  assert.equal(calls.length, 2, 'a failed batch should still use the built-in two attempts');
  assert.deepEqual(calls.map((call) => call.eventIds), [['m1'], ['m1']]);
  assert.equal(room.memoryCursors.a, 0, 'failed consolidation must not advance the committed cursor');

  fail = false;
  await room.queueMemoryConsolidation('a', { force: true });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].eventIds, ['m1'], 'the next attempt must retry the previously failed batch');
  assert.equal(room.memoryCursors.a, 1, 'cursor advances only after a successful consolidation');
});

test('error terminal flush drains messages that arrive while consolidation is already running', async () => {
  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => { markFirstStarted = resolve; });
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  const calls = [];

  const memory = {
    enabled: true,
    scope: 'agent',
    stats: () => ({ total: 0, byType: {} }),
    shouldConsolidate: (count, { force = false } = {}) => force ? count > 0 : count >= 1,
    async consolidate({ agentId, events }) {
      calls.push({ agentId, eventIds: events.map((event) => event.id) });
      if (agentId === 'a' && calls.filter((call) => call.agentId === 'a').length === 1) {
        markFirstStarted();
        await firstBlocked;
      }
      return { stored: [], usage: usage(), skipped: false };
    },
  };

  const room = new MemoryProfiledRoom({
    roomId: 'default-room',
    memoryManager: memory,
    agents: agents(),
    providerFactory,
  });
  room.createProviders();
  room.runId = 'run-error';
  room.topic = 'terminal flush test';
  room.status = 'running';
  room.history = [{ id: 'm1', speaker: 'user', name: 'Bạn', text: 'First event.' }];

  const queued = room.queueMemoryConsolidation('a');
  await firstStarted;

  room.history.push({ id: 'm2', speaker: 'user', name: 'Bạn', text: 'Second event before failure.' });
  room.status = 'error';
  room.emitState();

  releaseFirst();
  await queued;
  await Promise.all(Object.values(room.memoryQueues));

  const agentABatches = calls.filter((call) => call.agentId === 'a').map((call) => call.eventIds);
  assert.deepEqual(agentABatches, [['m1'], ['m2']]);
  assert.equal(room.memoryCursors.a, 2);
  assert.equal(room.memoryErrorFlushedRunId, 'run-error');
});

test('sqlite memory persists after closing and reopening the database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ai-chat-memory-'));
  const path = join(dir, 'agent-memory.sqlite');
  let store = null;

  try {
    store = new SqliteMemoryStore({ path });
    store.upsert({
      agentId: 'a',
      namespace: 'agent',
      type: 'semantic',
      key: 'observer.persistence_check',
      content: 'Persistent memory survives a database reopen.',
      importance: 0.9,
      confidence: 1,
    });
    store.close();
    store = null;

    store = new SqliteMemoryStore({ path });
    const memories = store.retrieve('a', {
      namespaces: ['agent'],
      query: 'persistent memory database reopen',
      limit: 5,
    });

    assert.equal(memories.length, 1);
    assert.match(memories[0].content, /survives a database reopen/i);
  } finally {
    try { store?.close?.(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});
