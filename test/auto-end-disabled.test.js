import test from 'node:test';
import assert from 'node:assert/strict';
import { agentAutoEndEnabled, decideConversationEnd } from '../src/conversation-end.js';

test('agent auto-end is disabled unless explicitly enabled', async () => {
  const previous = process.env.AGENT_AUTO_END_ENABLED;
  delete process.env.AGENT_AUTO_END_ENABLED;
  try {
    assert.equal(agentAutoEndEnabled(), false);
    let calls = 0;
    const provider = {
      async streamChat() {
        calls += 1;
        return { text: '{"end":true,"reason":"done"}', usage: null };
      },
    };
    const decision = await decideConversationEnd({
      provider,
      topic: 'test',
      agentId: 'a',
      history: [
        { speaker: 'a', name: 'A', text: '1' },
        { speaker: 'b', name: 'B', text: '2' },
        { speaker: 'a', name: 'A', text: '3' },
      ],
    });
    assert.equal(decision.end, false);
    assert.equal(decision.reason, 'auto-end-disabled');
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.AGENT_AUTO_END_ENABLED;
    else process.env.AGENT_AUTO_END_ENABLED = previous;
  }
});
