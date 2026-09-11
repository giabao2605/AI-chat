import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ConversationRoom } from '../src/orchestrator.js';

const agentA = { id: 'a', name: 'Alpha', apiKey: 'x', model: 'm1', baseUrl: 'http://mock' };
const agentB = { id: 'b', name: 'Beta', apiKey: 'y', model: 'm2', baseUrl: 'http://mock' };

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('parallel mode starts both agents concurrently while respecting the shared message cap', async () => {
  delete process.env.AGENT_AUTO_END_ENABLED;
  let active = 0;
  let maxActive = 0;

  const providerFactory = (config) => ({
    async streamChat({ messages, onDelta, signal }) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        await Promise.race([
          wait(35),
          new Promise((_, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })),
        ]);
        const text = `${config.name} trả lời`;
        onDelta(text);
        return {
          text,
          usage: { inputTokens: messages.length, outputTokens: 2, totalTokens: messages.length + 2, exact: true },
        };
      } finally {
        active -= 1;
      }
    },
  });

  const room = new ConversationRoom({ agentA, agentB, hardTurnLimit: 10, providerFactory });
  let sawBothTyping = false;
  room.on('state', (snapshot) => {
    if (snapshot.currentSpeakers?.length === 2) sawBothTyping = true;
  });
  const completed = new Promise((resolve) => {
    const listener = (snapshot) => {
      if (snapshot.status === 'completed') {
        room.off('state', listener);
        resolve(snapshot);
      }
    };
    room.on('state', listener);
  });

  await room.start({
    topicMode: 'manual',
    conversationMode: 'parallel',
    topic: 'Cùng bàn về một thành phố trên Sao Hỏa',
    maxTurns: 2,
    startSpeaker: 'a',
    sharedPrompt: 'Trò chuyện tự nhiên.',
  });

  const snapshot = await completed;
  assert.equal(snapshot.conversationMode, 'parallel');
  assert.equal(snapshot.turn, 2);
  assert.equal(snapshot.history.filter((item) => item.speaker === 'a' || item.speaker === 'b').length, 2);
  assert.deepEqual(new Set(snapshot.history.map((item) => item.speaker)), new Set(['a', 'b']));
  assert.equal(maxActive, 2);
  assert.equal(sawBothTyping, true);
});

test('turn mode remains sequential for backward compatibility', async () => {
  delete process.env.AGENT_AUTO_END_ENABLED;
  let active = 0;
  let maxActive = 0;
  const providerFactory = (config) => ({
    async streamChat({ messages, onDelta }) {
      active += 1;
      maxActive = Math.max(maxActive, active);
      try {
        await wait(10);
        const text = `${config.name} tuần tự`;
        onDelta(text);
        return { text, usage: { inputTokens: messages.length, outputTokens: 1, totalTokens: messages.length + 1, exact: true } };
      } finally {
        active -= 1;
      }
    },
  });
  const room = new ConversationRoom({ agentA, agentB, hardTurnLimit: 10, providerFactory });
  const completed = new Promise((resolve) => room.on('state', (snapshot) => snapshot.status === 'completed' && resolve(snapshot)));
  await room.start({ topicMode: 'manual', conversationMode: 'turns', topic: 'test', maxTurns: 2, startSpeaker: 'a', sharedPrompt: 'Rules' });
  const snapshot = await completed;
  assert.equal(snapshot.conversationMode, 'turns');
  assert.deepEqual(snapshot.history.map((item) => item.speaker), ['a', 'b']);
  assert.equal(maxActive, 1);
});

test('UI exposes the parallel mode selector and sends it in start payloads', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /id="conversationMode"/);
  assert.match(html, /value="parallel"/);
  assert.match(app, /conversationMode: els\.conversationMode\?\.value \|\| 'turns'/);
  assert.match(app, /currentSpeakers/);
});
