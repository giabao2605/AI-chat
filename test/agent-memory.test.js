import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentMemoryManager } from '../src/agent-memory.js';
import { MemoryProfiledRoom } from '../src/memory-profiled-room.js';
import { SqliteMemoryStore } from '../src/memory-store.js';

function usage() {
  return { inputTokens: 1, outputTokens: 1, totalTokens: 2, exact: true };
}

function waitForCompleted(room) {
  if (room.status === 'completed') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      room.off('state', onState);
      reject(new Error(`Room did not complete. Current status: ${room.status}`));
    }, 3000);
    const onState = (snapshot) => {
      if (snapshot.status !== 'completed') return;
      clearTimeout(timer);
      room.off('state', onState);
      resolve();
    };
    room.on('state', onState);
  });
}

test('memory store isolates agents, retrieves relevant entries and supersedes keyed facts', () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  try {
    store.upsert({
      agentId: 'a', namespace: 'agent', type: 'semantic', key: 'observer.favorite_game',
      content: 'Người quan sát thích game suy luận có nhiều agent độc lập.', importance: 0.9, confidence: 0.95,
    });
    store.upsert({
      agentId: 'b', namespace: 'agent', type: 'semantic',
      content: 'Mật mã kho hàng là BLUE-428.', importance: 1, confidence: 1,
    });

    const aSearch = store.retrieve('a', { namespaces: ['agent'], query: 'game suy luận agent', limit: 5 });
    assert.equal(aSearch.length, 1);
    assert.match(aSearch[0].content, /game suy luận/i);

    const unrelatedBSearch = store.retrieve('b', { namespaces: ['agent'], query: 'game suy luận agent', limit: 5 });
    assert.equal(unrelatedBSearch.length, 0, 'high-importance but unrelated memory must not pollute context');

    const relevantBSearch = store.retrieve('b', { namespaces: ['agent'], query: 'mật mã kho hàng BLUE', limit: 5 });
    assert.equal(relevantBSearch.length, 1);
    assert.match(relevantBSearch[0].content, /BLUE-428/);

    const old = store.list('a', { namespaces: ['agent'], includeInactive: true })[0];
    store.upsert({
      agentId: 'a', namespace: 'agent', type: 'semantic', key: 'observer.favorite_game',
      content: 'Người quan sát hiện thích game chiến thuật nhiều agent.', importance: 0.92, confidence: 0.98,
    });
    const all = store.list('a', { namespaces: ['agent'], includeInactive: true });
    const active = all.filter((item) => item.active);
    const inactive = all.filter((item) => !item.active);
    assert.equal(active.length, 1);
    assert.match(active[0].content, /chiến thuật/i);
    assert.equal(inactive.some((item) => item.id === old.id), true);
    assert.equal(active[0].supersedesId, old.id);
  } finally {
    store.close();
  }
});

test('memory manager keeps private context agent-scoped and consolidates only provenance-backed memories', async () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  const memory = new AgentMemoryManager({
    store,
    config: { enabled: true, scope: 'agent', minImportance: 0.3, maxCandidatesPerPass: 6 },
  });
  try {
    memory.rememberPrivateContext({
      id: 'private-1', senderId: 'a', recipientId: 'b', content: 'RED-731', createdAt: new Date().toISOString(),
    }, {
      a: { name: 'Luna 1' }, b: { name: 'Luna 2' }, c: { name: 'Luna 3' },
    }, { runId: 'run-1' });

    assert.match(JSON.stringify(memory.list('a')), /RED-731/);
    assert.match(JSON.stringify(memory.list('b')), /RED-731/);
    assert.doesNotMatch(JSON.stringify(memory.list('c')), /RED-731/);
    assert.equal(memory.retrieve('b', { query: 'RED-731', runId: 'run-1' }).length, 0, 'current-run private context is already injected by the live private-context layer');
    assert.match(JSON.stringify(memory.retrieve('b', { query: 'RED-731', runId: 'run-2' })), /RED-731/);

    const provider = {
      async streamChat() {
        return {
          text: JSON.stringify({ memories: [
            {
              type: 'semantic',
              key: 'observer.prefers_independent_agents',
              content: 'Người quan sát thích các agent có quyết định độc lập.',
              importance: 0.9,
              confidence: 0.95,
              sourceEventIds: ['m1'],
            },
            {
              type: 'belief',
              content: 'Tôi nghi Luna 3 đang che giấu một chi tiết.',
              importance: 0.7,
              confidence: 0.55,
              sourceEventIds: ['m3'],
            },
            {
              type: 'semantic',
              key: 'unverified.agent.claim',
              content: 'Kho bí mật nằm dưới tầng hầm.',
              importance: 1,
              confidence: 1,
              sourceEventIds: ['m2'],
            },
            {
              type: 'belief',
              content: 'Tôi tin kho bí mật nằm dưới tầng hầm.',
              importance: 0.8,
              confidence: 0.7,
              sourceEventIds: ['m2'],
            },
            {
              type: 'private',
              content: 'Memory consolidator không được phép tạo loại này.',
              importance: 1,
              confidence: 1,
              sourceEventIds: ['m1'],
            },
            {
              type: 'episodic',
              content: 'Ký ức không có provenance hợp lệ phải bị loại.',
              importance: 0.9,
              confidence: 0.9,
              sourceEventIds: ['does-not-exist'],
            },
          ] }),
          usage: usage(),
        };
      },
    };

    const result = await memory.consolidate({
      agentId: 'a',
      agentName: 'Luna 1',
      provider,
      topic: 'Thiết kế game multi-agent',
      runId: 'run-1',
      events: [
        { id: 'm1', speaker: 'user', name: 'Bạn', text: 'Tôi muốn các agent tự quyết định.' },
        { id: 'm2', speaker: 'c', name: 'Luna 3', text: 'Kho bí mật nằm dưới tầng hầm.' },
        { id: 'm3', speaker: 'a', name: 'Luna 1', text: 'Tôi nghi Luna 3 đang che giấu một chi tiết.' },
      ],
    });

    assert.equal(result.stored.length, 2);
    const memories = memory.list('a');
    const semantic = memories.find((item) => item.type === 'semantic' && /quyết định độc lập/i.test(item.content));
    const belief = memories.find((item) => item.type === 'belief' && /Luna 3/i.test(item.content));
    assert.ok(semantic);
    assert.ok(belief);
    assert.deepEqual(semantic.metadata.sourceEventIds, ['m1']);
    assert.deepEqual(belief.metadata.sourceEventIds, ['m3']);
    assert.equal(memories.some((item) => /Kho bí mật nằm dưới tầng hầm/i.test(item.content)), false);
    assert.equal(memories.some((item) => /provenance hợp lệ/i.test(item.content)), false);
  } finally {
    store.close();
  }
});

test('room injects only each agent own long-term memory into model context', async () => {
  const store = new SqliteMemoryStore({ path: ':memory:' });
  const memory = new AgentMemoryManager({
    store,
    config: {
      enabled: true,
      scope: 'agent',
      retrievalLimit: 6,
      consolidateEveryMessages: 100,
      minImportance: 0.3,
    },
  });
  const secret = 'BLUE-428-MEMORY-B-ONLY';
  memory.store.upsert({
    agentId: 'b', namespace: 'agent', type: 'semantic', content: `Mật mã thử nghiệm là ${secret}.`, importance: 1, confidence: 1,
  });

  const agents = {
    a: { id: 'a', name: 'Luna 1', apiKey: 'a', model: 'mock', baseUrl: 'http://mock' },
    b: { id: 'b', name: 'Luna 2', apiKey: 'b', model: 'mock', baseUrl: 'http://mock' },
    c: { id: 'c', name: 'Luna 3', apiKey: 'c', model: 'mock', baseUrl: 'http://mock' },
  };
  const captured = { a: [], b: [], c: [] };
  const providerFactory = (config) => ({
    async streamChat({ messages, onDelta = () => {} }) {
      const system = String(messages?.[0]?.content || '');
      if (/memory consolidator/i.test(system)) {
        return { text: '{"memories":[]}', usage: usage(), toolCalls: [] };
      }
      captured[config.id].push(structuredClone(messages));
      const text = `${config.name} reply`;
      onDelta(text);
      return { text, usage: usage(), toolCalls: [] };
    },
  });

  const room = new MemoryProfiledRoom({
    roomId: 'default-room',
    memoryManager: memory,
    agents,
    providerFactory,
    hardTurnLimit: 10,
  });

  try {
    const completed = waitForCompleted(room);
    await room.start({
      topic: 'Hãy thảo luận về mật mã thử nghiệm và cách quản lý thông tin.',
      maxTurns: 3,
      startSpeaker: 'a',
      sharedPrompt: 'Talk normally.',
    });
    await completed;
    await Promise.all(Object.values(room.memoryQueues));

    assert.doesNotMatch(JSON.stringify(captured.a), new RegExp(secret));
    assert.match(JSON.stringify(captured.b), new RegExp(secret));
    assert.doesNotMatch(JSON.stringify(captured.c), new RegExp(secret));
    assert.equal(room.snapshot().memory.byAgent.b.total >= 1, true);
  } finally {
    store.close();
  }
});

test('background consolidation keeps an immutable old-session batch across reset', async () => {
  let captured = null;
  let release;
  const blocker = new Promise((resolve) => { release = resolve; });
  const fakeMemory = {
    enabled: true,
    scope: 'agent',
    stats: () => ({ total: 0, byType: {} }),
    shouldConsolidate: () => true,
    async consolidate(args) {
      captured = args;
      await blocker;
      return { stored: [], usage: null, skipped: false };
    },
  };
  const agents = {
    a: { id: 'a', name: 'Luna 1', apiKey: 'a', model: 'mock', baseUrl: 'http://mock' },
    b: { id: 'b', name: 'Luna 2', apiKey: 'b', model: 'mock', baseUrl: 'http://mock' },
  };
  const room = new MemoryProfiledRoom({
    roomId: 'default-room',
    memoryManager: fakeMemory,
    agents,
    providerFactory: () => ({ async streamChat() { return { text: 'ok', usage: usage() }; } }),
  });
  room.createProviders();
  room.runId = 'run-old';
  room.topic = 'old topic';
  room.history = [{ id: 'old-1', speaker: 'user', name: 'Bạn', text: 'OLD SESSION EVENT' }];

  const queued = room.queueMemoryConsolidation('a', { force: true });
  room.runId = 'run-new';
  room.topic = 'new topic';
  room.history = [{ id: 'new-1', speaker: 'user', name: 'Bạn', text: 'NEW SESSION EVENT' }];
  room.resetMemoryRuntime(0);
  release();
  await queued;

  assert.equal(captured.runId, 'run-old');
  assert.equal(captured.topic, 'old topic');
  assert.equal(captured.events.length, 1);
  assert.match(captured.events[0].text, /OLD SESSION EVENT/);
  assert.doesNotMatch(captured.events[0].text, /NEW SESSION EVENT/);
});
