import test from 'node:test';
import assert from 'node:assert/strict';
import { detectConversationLoop } from '../src/multi-agent-room.js';
import { ReasoningMemoryProfiledRoom } from '../src/reasoning-memory-room.js';
import { ParallelBatchRoom } from '../src/parallel-batch-room.js';
import { isPassReply, isRepeatedReply, passStream } from '../src/conversation-progress.js';

const x = 'Database transactions require atomicity consistency isolation durability and reliable recovery after unexpected failures.';
const y = 'Frontend accessibility requires keyboard navigation contrast labels and readable typography across different screen sizes.';
const agents = Object.fromEntries(['a', 'b'].map(id => [id, { id, name: id, apiKey: 'mock', model: 'mock', baseUrl: 'https://example.test/v1' }]));

function roomFor(Room, reply) {
  return new Room({ agents, contextConfig: { summarizeAfter: 100 }, providerFactory: config => ({
    async streamChat({ onDelta }) {
      const text = reply(config.id);
      for (const char of text) onDelta?.(char);
      return { text, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, toolCalls: [] };
    },
  }) });
}

function paused(room) {
  return new Promise(resolve => {
    const listener = state => {
      if (state.status !== 'paused') return;
      room.off('state', listener);
      resolve(state);
    };
    room.on('state', listener);
  });
}

test('loop detector catches alternating repeated points and resets at user input', () => {
  const history = [x, y, x, y].map((text, i) => ({ speaker: i % 2 ? 'b' : 'a', text }));
  assert.equal(detectConversationLoop(history), true);
  assert.equal(detectConversationLoop([...history, { speaker: 'user', text: 'Explain that again' }]), false);
});

for (const Room of [ReasoningMemoryProfiledRoom, ParallelBatchRoom]) {
  for (const mode of ['turns', 'parallel']) {
    test(`${Room.name} ${mode}: repeats pause, user input resumes`, { timeout: 3000 }, async t => {
      const room = roomFor(Room, id => id === 'a' ? x : y);
      t.after(() => room.stop());
      const waiting = paused(room);
      await room.start({ topic: 'Discuss', maxTurns: 20, startSpeaker: 'a', conversationMode: mode });
      const state = await waiting;
      assert.ok(state.turn < 20);
      assert.ok(state.history.some(item => item.debug?.progress === 'repeat'));
      const repeated = state.history.find(item => item.debug?.progress === 'repeat');
      assert.equal(room.parallelRelevantMessage(repeated, repeated.speaker === 'a' ? 'b' : 'a'), false);
      room.addUserMessage('Explain the last point again');
      assert.equal(room.status, 'running');
      assert.equal(room.noProgressTurns, 0);
    });

    test(`${Room.name} ${mode}: structured pass is hidden and bounded`, { timeout: 3000 }, async t => {
      const room = roomFor(Room, () => '{"action":"pass"}');
      t.after(() => room.stop());
      const deltas = [];
      room.on('message:delta', event => deltas.push(event.delta));
      const waiting = paused(room);
      await room.start({ topic: 'Discuss', maxTurns: 20, startSpeaker: 'a', conversationMode: mode });
      const state = await waiting;
      assert.equal(state.history.length, 0);
      assert.equal(deltas.length, 0);
      assert.equal(state.turn, 2);
      assert.equal(state.stats.a.totalTokens + state.stats.b.totalTokens, 4);
      if (mode === 'parallel') assert.ok(Object.values(state.agentStates).every(agent => agent.status === 'done'));
    });
  }
}

test('repeated words with changed numbers, negation or substantial new content remain progress', async () => {
  for (const text of [x.replace('require', 'do not require'), `${x} A separate practical example is testing simultaneous bank transfers with two concurrent clients.`, x.replace('failures', '10 failures')]) {
    const room = roomFor(ReasoningMemoryProfiledRoom, () => text);
    room.status = 'running';
    room.topic = 'test';
    room.settings = { sharedPrompt: 'test', personas: {}, temperature: 0, maxOutputTokens: 100 };
    room.history = [{ id: 'old', speaker: 'a', text: x }];
    room.createProviders();
    const result = await room.executeAgentTurn('b');
    assert.equal(result.entry.debug.progress, 'new');
    room.stop();
  }
});

test('manual pause stays paused on user input', () => {
  const room = roomFor(ReasoningMemoryProfiledRoom, () => x);
  room.topic = 'test';
  room.status = 'running';
  room.pause();
  room.addUserMessage('hello');
  assert.equal(room.status, 'paused');
  room.stop();
});

test('pass control is strict and only buffers its possible prefix', () => {
  for (const text of ['{"action":"pass"}', '{ "action": "pass" }', '{"action":"pass"', '{"action":"pass","text":"hello"}', '{"action":"pass"} more', 'Ordinary dialogue']) {
    const output = [];
    const stream = passStream(delta => output.push(delta));
    for (const char of text) stream.write(char);
    if (text === 'Ordinary dialogue') assert.equal(output.join(''), text);
    const passed = isPassReply(text);
    stream.finish(passed);
    assert.equal(output.join(''), passed ? '' : text);
    assert.equal(passed, text === '{"action":"pass"}' || text === '{ "action": "pass" }');
  }
  assert.equal(isPassReply('{"action":"reply","action":"pass"}'), false);
});

test('concurrent duplicate is compared with committed history; scenario and new user are exempt', () => {
  const room = roomFor(ReasoningMemoryProfiledRoom, () => x);
  room.status = 'running';
  room.topic = 'test';
  const entry = { id: 'a1', speaker: 'a', text: x, debug: {}, usage: null };
  room.finishAgentTurn(entry, []);
  const duplicate = room.finishAgentTurn({ ...entry, id: 'b1', speaker: 'b' }, []);
  assert.equal(duplicate.entry.debug.progress, 'repeat');
  room.addUserMessage('A new question');
  room.finishAgentTurn({ ...entry, text: '{"action":"pass"}' }, []);
  assert.equal(room.noProgressTurns, 0, 'a stale pass must not suppress new input');
  room.scenarioController = {};
  const scenario = room.finishAgentTurn({ ...entry, text: '{"action":"pass"}' }, room.history.slice());
  assert.equal(scenario.entry.debug.progress, 'new');
  assert.equal(scenario.entry.text, '{"action":"pass"}');
  room.stop();
  assert.equal(isRepeatedReply('Mình đồng ý với bạn.', [{ speaker: 'a', text: 'Mình đồng ý với bạn.' }]), true);
});

test('pending private context prevents automatic pause', () => {
  const room = roomFor(ReasoningMemoryProfiledRoom, () => x);
  room.status = 'running';
  room.noProgressTurns = 2;
  room.privateInboxVersion.b = 1;
  room.pauseIfQuiescent();
  assert.equal(room.status, 'running');
  room.agentRuntime.b.privateContextSeenVersion = 1;
  room.pauseIfQuiescent();
  assert.equal(room.status, 'paused');
  room.stop();
});

test('explicit resume works after all agents pass without any transcript', { timeout: 3000 }, async t => {
  const room = roomFor(ReasoningMemoryProfiledRoom, () => '{"action":"pass"}');
  t.after(() => room.stop());
  const firstPause = paused(room);
  await room.start({ topic: 'Discuss', conversationMode: 'parallel', maxTurns: 10 });
  await firstPause;
  const secondPause = paused(room);
  room.resume();
  const state = await secondPause;
  assert.equal(state.turn, 4);
  assert.equal(state.history.length, 0);
});
