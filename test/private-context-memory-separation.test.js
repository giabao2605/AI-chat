import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentMemoryManager } from '../src/agent-memory.js';
import { MemoryProfiledRoom } from '../src/memory-profiled-room.js';
import { SqliteMemoryStore } from '../src/memory-store.js';

const agents = {
  a: { id: 'a', name: 'Luna 1', apiKey: 'a', model: 'mock', baseUrl: 'http://mock' },
  b: { id: 'b', name: 'Luna 2', apiKey: 'b', model: 'mock', baseUrl: 'http://mock' },
  c: { id: 'c', name: 'Luna 3', apiKey: 'c', model: 'mock', baseUrl: 'http://mock' },
};

function providerFactory() {
  return {
    async streamChat() {
      return {
        text: 'ok',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, exact: true },
        toolCalls: [],
      };
    },
  };
}

function createMemory(store) {
  return new AgentMemoryManager({
    store,
    config: {
      enabled: true,
      scope: 'agent',
      retrievalLimit: 8,
      minImportance: 0.3,
    },
  });
}

test('legacy auto-persisted private context is deactivated while normal long-term memory stays active', () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  try {
    const legacyPrivate = store.upsert({
      agentId: 'a',
      namespace: 'agent',
      type: 'private',
      key: 'private:legacy:sender',
      content: 'Bạn đã gửi riêng cho Luna 2: LEGACY-PRIVATE-001',
      importance: 0.95,
      confidence: 1,
      visibility: 'private',
      sourceType: 'private_context',
      sourceId: 'legacy-private',
      runId: 'run-old',
    });
    const semantic = store.upsert({
      agentId: 'a',
      namespace: 'agent',
      type: 'semantic',
      key: 'observer.answer_style',
      content: 'Người dùng thích câu trả lời trực tiếp.',
      importance: 0.8,
      confidence: 1,
      sourceType: 'conversation_consolidation',
      runId: 'run-old',
    });

    const memory = createMemory(store);
    const room = new MemoryProfiledRoom({
      roomId: 'default-room',
      memoryManager: memory,
      agents,
      providerFactory,
    });

    assert.equal(room.legacyPrivateContextDeactivated, 1);
    const all = memory.list('a', { includeInactive: true });
    assert.equal(all.find((item) => item.id === legacyPrivate.id)?.active, false);
    assert.equal(all.find((item) => item.id === semantic.id)?.active, true);
  } finally {
    store.close();
  }
});

test('new private context remains session-only and is not copied into sqlite long-term memory', () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  try {
    const memory = createMemory(store);
    const room = new MemoryProfiledRoom({
      roomId: 'default-room',
      memoryManager: memory,
      agents,
      providerFactory,
    });
    room.runId = 'run-session-private';

    const secret = 'SESSION-PRIVATE-ONLY-842';
    const entry = room.recordPrivateContext('a', 'b', secret);

    assert.equal(room.privateContexts.length, 1);
    assert.equal(entry.senderId, 'a');
    assert.equal(entry.recipientId, 'b');
    assert.match(room.privateContextSystemBlock('a'), new RegExp(secret));
    assert.match(room.privateContextSystemBlock('b'), new RegExp(secret));
    assert.doesNotMatch(room.privateContextSystemBlock('c'), new RegExp(secret));

    const sqliteRows = [
      ...memory.list('a', { includeInactive: true }),
      ...memory.list('b', { includeInactive: true }),
      ...memory.list('c', { includeInactive: true }),
    ];
    assert.equal(sqliteRows.some((item) => String(item.content).includes(secret)), false);
    assert.equal(memory.stats('a').byType.private || 0, 0);
    assert.equal(memory.stats('b').byType.private || 0, 0);
  } finally {
    store.close();
  }
});
