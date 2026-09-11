import test from 'node:test';
import assert from 'node:assert/strict';
import { ResumableConversationRoom } from '../src/resumable-room.js';
import { getHistoryResumePlan } from '../public/history-resume.js';

const agentA = { id: 'a', name: 'Alpha', apiKey: 'x', model: 'm1', baseUrl: 'http://mock' };
const agentB = { id: 'b', name: 'Beta', apiKey: 'y', model: 'm2', baseUrl: 'http://mock' };

function providerFactory(config) {
  return {
    async streamChat({ messages, onDelta }) {
      const text = `${config.name} tiếp tục`;
      onDelta(text);
      return {
        text,
        usage: { inputTokens: messages.length, outputTokens: 2, totalTokens: messages.length + 2, exact: true },
      };
    },
  };
}

function oldSession(overrides = {}) {
  return {
    runId: 'old-run',
    topic: 'Chủ đề cũ',
    status: 'stopped',
    turn: 2,
    maxTurns: 4,
    history: [
      { id: 'a1', speaker: 'a', name: 'Alpha', text: 'A cũ', usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4, exact: true } },
      { id: 'b1', speaker: 'b', name: 'Beta', text: 'B cũ', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5, exact: true } },
    ],
    stats: {
      a: { inputTokens: 2, outputTokens: 2, totalTokens: 4, turns: 1, estimatedTurns: 0 },
      b: { inputTokens: 3, outputTokens: 2, totalTokens: 5, turns: 1, estimatedTurns: 0 },
    },
    ...overrides,
  };
}

test('resume plan preserves the original cap while there are turns left', () => {
  const plan = getHistoryResumePlan(oldSession(), { requestedMaxTurns: 99, liveStatus: 'completed' });
  assert.equal(plan.canResume, true);
  assert.equal(plan.maxTurns, 4);
  assert.equal(plan.usedTurns, 2);
  assert.equal(plan.remainingTurns, 2);
  assert.equal(plan.extended, false);
});

test('resume plan requires an explicit higher cap after the old cap is exhausted', () => {
  const session = oldSession({ maxTurns: 2 });
  const blocked = getHistoryResumePlan(session, { requestedMaxTurns: 2, liveStatus: 'idle' });
  assert.equal(blocked.canResume, false);
  assert.equal(blocked.reason, 'limit-reached');
  assert.equal(blocked.requiredMinTurns, 3);

  const extended = getHistoryResumePlan(session, { requestedMaxTurns: 3, liveStatus: 'idle' });
  assert.equal(extended.canResume, true);
  assert.equal(extended.maxTurns, 3);
  assert.equal(extended.remainingTurns, 1);
  assert.equal(extended.extended, true);
});

test('room resumes the same historical run and counts toward the original maximum', async () => {
  delete process.env.AGENT_AUTO_END_ENABLED;
  const room = new ResumableConversationRoom({ agentA, agentB, hardTurnLimit: 10, providerFactory });
  const completed = new Promise((resolve) => {
    const listener = (snapshot) => {
      if (snapshot.status === 'completed') {
        room.off('state', listener);
        resolve(snapshot);
      }
    };
    room.on('state', listener);
  });

  await room.continueFromHistory({
    session: oldSession(),
    maxTurns: 99,
    temperature: 0.8,
    maxOutputTokens: 1200,
    sharedPrompt: 'Rules',
  });

  const snapshot = await completed;
  assert.equal(snapshot.runId, 'old-run');
  assert.equal(snapshot.turn, 4);
  assert.equal(snapshot.maxTurns, 4);
  assert.equal(snapshot.history.length, 4);
  assert.deepEqual(snapshot.history.map((item) => item.speaker), ['a', 'b', 'a', 'b']);
  assert.equal(snapshot.stats.a.turns, 2);
  assert.equal(snapshot.stats.b.turns, 2);
});

test('server-side resume rejects an exhausted session until maxTurns is raised', async () => {
  delete process.env.AGENT_AUTO_END_ENABLED;
  const room = new ResumableConversationRoom({ agentA, agentB, hardTurnLimit: 10, providerFactory });
  const session = oldSession({ maxTurns: 2, status: 'completed' });

  await assert.rejects(
    room.continueFromHistory({ session, maxTurns: 2, sharedPrompt: 'Rules' }),
    /đã dùng 2\/2 lượt/i,
  );

  const completed = new Promise((resolve) => {
    const listener = (snapshot) => {
      if (snapshot.status === 'completed') {
        room.off('state', listener);
        resolve(snapshot);
      }
    };
    room.on('state', listener);
  });
  await room.continueFromHistory({ session, maxTurns: 3, sharedPrompt: 'Rules' });
  const snapshot = await completed;
  assert.equal(snapshot.turn, 3);
  assert.equal(snapshot.maxTurns, 3);
});
