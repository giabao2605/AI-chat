import test from 'node:test';
import assert from 'node:assert/strict';
import { safeResearchUrl } from '../src/deep-research.js';
import { detectConversationLoop, loopSimilarity, MultiAgentRoom } from '../src/multi-agent-room.js';
import { RoomManager } from '../src/room-manager.js';

test('deep research rejects local/private URLs', () => {
  assert.equal(safeResearchUrl('http://127.0.0.1:3000/admin'), '');
  assert.equal(safeResearchUrl('http://192.168.1.2/private'), '');
  assert.match(safeResearchUrl('https://example.com/a#b'), /^https:\/\/example\.com\/a$/);
});

test('room manager isolates room instances', () => {
  let sequence = 0;
  const manager = new RoomManager({ createRoom: () => ({ id: ++sequence, status: 'idle', stop() {} }), maxRooms: 4 });
  assert.notEqual(manager.get('room_aaaaaaaa').room, manager.get('room_bbbbbbbb').room);
  assert.equal(manager.get('room_aaaaaaaa').room.id, 1);
  assert.equal(manager.stats().rooms, 2);
});

test('loop detector catches repeated AI phrasing', () => {
  const a = 'Chúng ta nên ưu tiên kiểm thử tự động vì nó giúp phát hiện lỗi sớm và giảm regression.';
  const b = 'Theo tôi chúng ta nên ưu tiên kiểm thử tự động để phát hiện lỗi sớm và giảm regression.';
  assert.ok(loopSimilarity(a, b) > 0.5);
  assert.equal(detectConversationLoop([
    { speaker: 'a', text: a },
    { speaker: 'b', text: b },
    { speaker: 'c', text: a },
  ], 0.5), true);
});

test('multi-agent room can schedule Agent C in a four-agent room', async () => {
  const agents = Object.fromEntries(['a', 'b', 'c', 'd'].map((id) => [id, {
    id, name: `Agent ${id.toUpperCase()}`, apiKey: 'x', model: 'mock', baseUrl: 'https://example.test/v1',
  }]));
  const providerFactory = () => ({
    async streamChat({ onDelta }) {
      onDelta?.('ok');
      return { text: 'ok', usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3, exact: true }, toolCalls: [] };
    },
  });
  const room = new MultiAgentRoom({ agents, providerFactory, hardTurnLimit: 10, contextConfig: { summarizeAfter: 100 } });
  const done = new Promise((resolve) => room.once('message:done', resolve));
  await room.start({ topicMode: 'manual', topic: 'test', maxTurns: 1, startSpeaker: 'c', conversationMode: 'turns' });
  const message = await done;
  assert.equal(message.speaker, 'c');
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(room.stats.c.turns, 1);
  assert.equal(room.status, 'completed');
});
