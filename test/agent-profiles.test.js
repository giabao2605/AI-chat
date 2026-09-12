import test from 'node:test';
import assert from 'node:assert/strict';
import { ProfiledRoom } from '../src/profiled-room.js';

function agents() {
  return Object.fromEntries(['a', 'b'].map((id) => [id, {
    id,
    name: `Agent ${id.toUpperCase()}`,
    apiKey: 'test-key',
    model: 'same-model',
    baseUrl: 'https://example.test/v1',
  }]));
}

function waitForEvent(emitter, eventName) {
  return new Promise((resolve) => emitter.once(eventName, resolve));
}

test('agent profile changes identity prompt and generation settings without changing model config', async () => {
  const calls = [];
  const providerFactory = (config) => ({
    async streamChat(options) {
      calls.push({ config: { ...config }, options });
      options.onDelta?.('Xin chào');
      return {
        text: 'Xin chào',
        usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13, exact: true },
        toolCalls: [],
      };
    },
  });

  const room = new ProfiledRoom({
    agents: agents(),
    providerFactory,
    hardTurnLimit: 10,
    contextConfig: { summarizeAfter: 100 },
  });

  const done = waitForEvent(room, 'message:done');
  await room.start({
    topicMode: 'manual',
    topic: 'Kiểm tra profile',
    conversationMode: 'turns',
    maxTurns: 1,
    startSpeaker: 'a',
    temperature: 0.8,
    maxOutputTokens: 1200,
    agentProfiles: {
      a: {
        name: 'Nova',
        role: 'Người đề xuất giả thuyết',
        persona: 'Tò mò, độc lập và thích tìm hướng mới.',
        speakingStyle: 'Ngắn gọn, dùng ví dụ cụ thể.',
        temperature: 0.35,
        maxOutputTokens: 444,
      },
      b: {
        name: 'Atlas',
        role: 'Người phản biện',
        temperature: 1.1,
        maxOutputTokens: 777,
      },
    },
  });

  const message = await done;
  assert.equal(message.name, 'Nova');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].config.model, 'same-model');
  assert.equal(calls[0].options.temperature, 0.35);
  assert.equal(calls[0].options.maxOutputTokens, 444);

  const system = String(calls[0].options.messages?.[0]?.content || '');
  assert.match(system, /Danh tính của bạn trong phòng này là Nova/);
  assert.match(system, /Vai trò chính: Người đề xuất giả thuyết/);
  assert.match(system, /Tính cách: Tò mò, độc lập/);
  assert.match(system, /Kiểu nói: Ngắn gọn/);
  assert.match(system, /Không suy đoán hoặc khẳng định model, provider/);

  const snapshot = room.snapshot();
  assert.equal(snapshot.agentProfiles.a.name, 'Nova');
  assert.equal(snapshot.agentProfiles.a.temperature, 0.35);
  assert.equal(snapshot.agentProfiles.b.name, 'Atlas');
});

test('profiles clamp unsafe numeric ranges and keep names isolated per room', async () => {
  const providerFactory = () => ({
    async streamChat(options) {
      options.onDelta?.('ok');
      return { text: 'ok', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, exact: true }, toolCalls: [] };
    },
  });

  const first = new ProfiledRoom({ agents: agents(), providerFactory, hardTurnLimit: 2, contextConfig: { summarizeAfter: 100 } });
  const second = new ProfiledRoom({ agents: agents(), providerFactory, hardTurnLimit: 2, contextConfig: { summarizeAfter: 100 } });

  const firstDone = waitForEvent(first, 'message:done');
  await first.start({
    topicMode: 'manual', topic: 'x', maxTurns: 1, startSpeaker: 'a',
    agentProfiles: { a: { name: 'Nova', temperature: 99, maxOutputTokens: 999999 } },
  });
  await firstDone;

  assert.equal(first.snapshot().agentProfiles.a.temperature, 2);
  assert.equal(first.snapshot().agentProfiles.a.maxOutputTokens, 16000);
  assert.equal(first.agentConfigs.a.name, 'Nova');
  assert.equal(second.agentConfigs.a.name, 'Agent A');
});
