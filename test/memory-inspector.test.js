import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentMemoryManager } from '../src/agent-memory.js';
import { SqliteMemoryStore } from '../src/memory-store.js';

function createManager(store) {
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

test('memory inspector preview uses activation rules without mutating access counters', () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  const memory = createManager(store);
  try {
    const game = store.upsert({
      agentId: 'a',
      namespace: 'agent',
      type: 'episodic',
      content: 'Trong game Ma Sói lần trước, Luna 1 đã bảo vệ dân làng.',
      importance: 0.9,
      confidence: 1,
      runId: 'run-game',
    });

    const greeting = memory.inspect('a', { query: 'hello buổi sáng 4 đứa' });
    const greetingGame = greeting.find((item) => item.id === game.id);
    assert.equal(greetingGame.wouldRecall, false);
    assert.equal(greetingGame.accessCount, 0);

    const explicit = memory.inspect('a', { query: 'mày nhớ game Ma Sói lần trước không?' });
    const explicitGame = explicit.find((item) => item.id === game.id);
    assert.equal(explicitGame.wouldRecall, true);
    assert.ok(explicitGame.relevance > 0);

    const after = memory.list('a').find((item) => item.id === game.id);
    assert.equal(after.accessCount, 0, 'inspection must not affect future retrieval ranking');
  } finally {
    store.close();
  }
});

test('forgetMemory only deactivates the selected memory for the selected agent', () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  const memory = createManager(store);
  try {
    const first = store.upsert({
      agentId: 'a', namespace: 'agent', type: 'semantic',
      content: 'Người dùng thích câu trả lời ngắn gọn.', importance: 0.8, confidence: 1,
    });
    const second = store.upsert({
      agentId: 'a', namespace: 'agent', type: 'semantic',
      content: 'Người dùng thích ví dụ có code.', importance: 0.8, confidence: 1,
    });
    const otherAgent = store.upsert({
      agentId: 'b', namespace: 'agent', type: 'semantic',
      content: 'Memory riêng của agent B.', importance: 0.8, confidence: 1,
    });

    assert.equal(memory.forgetMemory('a', first.id), 1);
    const a = memory.inspect('a', { includeInactive: true });
    const b = memory.inspect('b', { includeInactive: true });
    assert.equal(a.find((item) => item.id === first.id)?.active, false);
    assert.equal(a.find((item) => item.id === second.id)?.active, true);
    assert.equal(b.find((item) => item.id === otherAgent.id)?.active, true);
  } finally {
    store.close();
  }
});

test('deactivateAgentMemories forgets all active memories but keeps audit rows visible', () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  const memory = createManager(store);
  try {
    store.upsert({ agentId: 'a', namespace: 'agent', type: 'semantic', content: 'Fact one', importance: 0.8, confidence: 1 });
    store.upsert({ agentId: 'a', namespace: 'agent', type: 'episodic', content: 'Episode two', importance: 0.8, confidence: 1 });

    assert.equal(memory.deactivateAgentMemories('a'), 2);
    assert.equal(memory.list('a').length, 0);
    const audit = memory.inspect('a', { includeInactive: true });
    assert.equal(audit.length, 2);
    assert.ok(audit.every((item) => item.active === false));
  } finally {
    store.close();
  }
});
