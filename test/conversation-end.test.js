import test from 'node:test';
import assert from 'node:assert/strict';
import { decideConversationEnd, explicitStopRequested, parseConversationEndDecision } from '../src/conversation-end.js';

process.env.AGENT_AUTO_END_ENABLED = 'true';

test('conversation end parser accepts strict JSON and fails closed', () => {
  assert.deepEqual(parseConversationEndDecision('```json\n{"end":true,"reason":"đã hội tụ"}\n```'), {
    end: true,
    reason: 'đã hội tụ',
  });
  assert.equal(parseConversationEndDecision('not json').end, false);
});

test('explicit human stop requests are detected without matching negations', () => {
  assert.equal(explicitStopRequested([{ speaker: 'user', text: 'thôi kết thúc đi' }]), true);
  assert.equal(explicitStopRequested([{ speaker: 'user', text: 'đủ rồi, dừng đi' }]), true);
  assert.equal(explicitStopRequested([{ speaker: 'user', text: 'đừng dừng, nói tiếp đi' }]), false);
});

test('a new user message after the agent reply prevents stale auto-ending', async () => {
  let calls = 0;
  const provider = { async streamChat() { calls += 1; throw new Error('should not be called'); } };
  const decision = await decideConversationEnd({
    provider,
    topic: 'test',
    agentId: 'a',
    agentName: 'A',
    history: [
      { speaker: 'a', name: 'A', text: 'Tôi vừa trả lời xong.' },
      { speaker: 'user', name: 'Bạn', text: 'Khoan, còn ý này nữa.' },
    ],
  });
  assert.equal(decision.end, false);
  assert.equal(calls, 0);
});

test('explicit stop ends after the answering agent without another model decision call', async () => {
  let calls = 0;
  const provider = { async streamChat() { calls += 1; throw new Error('should not be called'); } };
  const decision = await decideConversationEnd({
    provider,
    topic: 'test',
    agentId: 'b',
    agentName: 'B',
    history: [
      { speaker: 'user', name: 'Bạn', text: 'dừng cuộc trò chuyện đi' },
      { speaker: 'b', name: 'B', text: 'Được, mình kết lại ở đây.' },
    ],
  });
  assert.equal(decision.end, true);
  assert.equal(calls, 0);
});

test('natural ending utility uses a conservative hidden decision after enough AI turns', async () => {
  const calls = [];
  const provider = {
    async streamChat(options) {
      calls.push(options);
      return {
        text: '{"end":true,"reason":"Hai bên đã thống nhất kết luận."}',
        usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13, exact: true },
      };
    },
  };
  const decision = await decideConversationEnd({
    provider,
    topic: 'Một chủ đề hữu hạn',
    agentId: 'a',
    agentName: 'A',
    history: [
      { speaker: 'a', name: 'A', text: 'ý 1' },
      { speaker: 'b', name: 'B', text: 'ý 2' },
      { speaker: 'a', name: 'A', text: 'kết luận chung' },
    ],
  });
  assert.equal(decision.end, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].temperature, 0);
  assert.equal(calls[0].maxOutputTokens, 160);
});
