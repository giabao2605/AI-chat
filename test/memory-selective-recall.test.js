import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentMemoryManager, memoryQueryFromHistory } from '../src/agent-memory.js';
import { SqliteMemoryStore } from '../src/memory-store.js';
import { addDeletedHistoryRunIds, filterDeletedHistory } from '../public/history.js';

function manager(store) {
  return new AgentMemoryManager({
    store,
    config: {
      enabled: true,
      scope: 'agent',
      retrievalLimit: 8,
      minImportance: 0.3,
      maxCandidatesPerPass: 6,
    },
  });
}

function usage() {
  return { inputTokens: 1, outputTokens: 1, totalTokens: 2, exact: true };
}

test('generic greeting does not activate an old high-importance game episode', () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  const memory = manager(store);
  try {
    store.upsert({
      agentId: 'a',
      namespace: 'agent',
      type: 'episodic',
      content: 'Trong game Ma Sói, Luna 1 đang là Sói và cần tiếp tục vòng đêm theo luật cũ.',
      importance: 1,
      confidence: 1,
      runId: 'run-game-old',
    });

    const recalled = memory.retrieve('a', {
      query: 'hello buổi sáng 4 đứa',
      runId: 'run-new',
    });

    assert.deepEqual(recalled, []);
  } finally {
    store.close();
  }
});

test('explicitly referring to the old game still recalls the related episode', () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  const memory = manager(store);
  try {
    store.upsert({
      agentId: 'a',
      namespace: 'agent',
      type: 'episodic',
      content: 'Trong game Ma Sói hôm trước, Luna 1 đã chọn bảo vệ dân làng ở vòng cuối.',
      importance: 0.9,
      confidence: 0.95,
      runId: 'run-game-old',
    });

    const recalled = memory.retrieve('a', {
      query: 'mày nhớ game Ma Sói hôm trước không?',
      runId: 'run-new',
    });

    assert.equal(recalled.length, 1);
    assert.match(recalled[0].content, /Ma Sói/i);
  } finally {
    store.close();
  }
});

test('stable semantic preference remains available when the current intent is relevant', () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  const memory = manager(store);
  try {
    store.upsert({
      agentId: 'a',
      namespace: 'agent',
      type: 'semantic',
      key: 'observer.code_style',
      content: 'Người dùng thích câu trả lời code ngắn gọn và trực tiếp.',
      importance: 0.9,
      confidence: 0.95,
      runId: 'run-pref',
    });

    const recalled = memory.retrieve('a', {
      query: 'viết code ngắn gọn cho tao',
      runId: 'run-new',
    });

    assert.equal(recalled.length, 1);
    assert.match(recalled[0].content, /ngắn gọn/i);
  } finally {
    store.close();
  }
});

test('memory query uses user/tool intent and ignores agent-generated continuation text', () => {
  const query = memoryQueryFromHistory([
    { speaker: 'a', text: 'Tiếp tục game Ma Sói: đêm nay chúng ta bỏ phiếu cho Luna 3.' },
    { speaker: 'b', text: 'Tôi đồng ý tiếp tục đúng luật game cũ.' },
    { speaker: 'user', text: 'hello buổi sáng 4 đứa' },
  ], 'Chào buổi sáng');

  assert.match(query, /hello buổi sáng/i);
  assert.doesNotMatch(query, /Ma Sói/i);
  assert.doesNotMatch(query, /bỏ phiếu/i);
});

test('consolidation rejects session-scoped game state but keeps long-term user preference', async () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  const memory = manager(store);
  const provider = {
    async streamChat() {
      return {
        text: JSON.stringify({
          memories: [
            {
              type: 'episodic',
              retention: 'session',
              content: 'Trong game hiện tại, Luna 1 là Sói và phải tiếp tục vòng đêm.',
              importance: 1,
              confidence: 1,
              sourceEventIds: ['m1'],
            },
            {
              type: 'semantic',
              retention: 'long_term',
              key: 'observer.response_style',
              content: 'Người dùng thích câu trả lời súc tích.',
              importance: 0.9,
              confidence: 0.95,
              sourceEventIds: ['m2'],
            },
          ],
        }),
        usage: usage(),
      };
    },
  };

  try {
    const result = await memory.consolidate({
      agentId: 'a',
      agentName: 'Luna 1',
      provider,
      runId: 'run-game',
      topic: 'Chơi Ma Sói',
      events: [
        { id: 'm1', speaker: 'user', name: 'Bạn', text: 'Ván này Luna 1 là Sói, tiếp tục theo luật game.' },
        { id: 'm2', speaker: 'user', name: 'Bạn', text: 'Ngoài game thì tao thích câu trả lời súc tích.' },
      ],
    });

    assert.equal(result.stored.length, 1);
    assert.equal(result.stored[0].type, 'semantic');
    assert.match(result.stored[0].content, /súc tích/i);
    assert.equal(memory.list('a').some((item) => /Luna 1 là Sói/i.test(item.content)), false);
  } finally {
    store.close();
  }
});

test('forgetRuns deactivates memories belonging to deleted history and leaves other runs intact', () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  const memory = manager(store);
  try {
    const forgotten = store.upsert({
      agentId: 'a', namespace: 'agent', type: 'episodic',
      content: 'Game cũ cần bị quên khi lịch sử bị xóa.', importance: 0.9, confidence: 1, runId: 'run-delete',
    });
    const kept = store.upsert({
      agentId: 'a', namespace: 'agent', type: 'semantic',
      content: 'Thông tin từ phiên khác vẫn còn.', importance: 0.9, confidence: 1, runId: 'run-keep',
    });

    assert.equal(memory.forgetRuns(['run-delete']), 1);

    const all = memory.list('a', { includeInactive: true });
    assert.equal(all.find((item) => item.id === forgotten.id)?.active, false);
    assert.equal(all.find((item) => item.id === kept.id)?.active, true);
  } finally {
    store.close();
  }
});

test('history deletion syncs run tombstones to the backend memory endpoint in browsers', async () => {
  const originalWindow = globalThis.window;
  const calls = [];
  globalThis.window = {
    fetch(path, options) {
      calls.push({ path, options });
      return Promise.resolve({ ok: true });
    },
  };

  try {
    const deleted = addDeletedHistoryRunIds([], ['run-old']);
    assert.deepEqual(deleted, ['run-old']);
    filterDeletedHistory([
      { runId: 'run-old' },
      { runId: 'run-keep' },
    ], deleted);

    await Promise.resolve();
    assert.equal(calls.length >= 2, true, 'new deletion and startup reconciliation should both sync');
    assert.equal(calls[0].path, '/api/memory/forget-runs');
    assert.deepEqual(JSON.parse(calls[0].options.body).runIds, ['run-old']);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
