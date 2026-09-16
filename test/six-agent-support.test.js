import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AGENT_IDS, getAllAgentConfigs, getPublicConfig } from '../src/config.js';
import { MultiAgentRoom } from '../src/multi-agent-room.js';
import { ProfiledRoom } from '../src/profiled-room.js';
import { countHistoryAiTurns } from '../public/history-resume.js';

const SIX = ['a', 'b', 'c', 'd', 'e', 'f'];

function mockAgents() {
  return Object.fromEntries(SIX.map((id) => [id, {
    id,
    name: `Agent ${id.toUpperCase()}`,
    apiKey: 'shared-key',
    model: 'gpt-5.6-luna',
    baseUrl: 'https://api.proxyllm.eu/v1',
  }]));
}

function completion(room) {
  return new Promise((resolve) => {
    const onState = (state) => {
      if (state.status !== 'completed') return;
      room.off('state', onState);
      resolve(state);
    };
    room.on('state', onState);
  });
}

test('config exposes six slots and optional E/F can inherit the shared ProxyLLM key', () => {
  const names = [
    'PROVIDER_BASE_URL', 'PROVIDER_API_KEY',
    ...SIX.flatMap((id) => {
      const upper = id.toUpperCase();
      return [`AGENT_${upper}_NAME`, `AGENT_${upper}_API_KEY`, `AGENT_${upper}_MODEL`, `AGENT_${upper}_BASE_URL`];
    }),
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));

  try {
    process.env.PROVIDER_BASE_URL = 'https://api.proxyllm.eu/v1';
    process.env.PROVIDER_API_KEY = 'one-shared-key';
    for (const id of SIX) {
      const upper = id.toUpperCase();
      delete process.env[`AGENT_${upper}_API_KEY`];
      delete process.env[`AGENT_${upper}_BASE_URL`];
      process.env[`AGENT_${upper}_MODEL`] = 'gpt-5.6-luna';
    }

    assert.deepEqual(AGENT_IDS, SIX);
    const agents = getAllAgentConfigs();
    assert.equal(agents.e.apiKey, 'one-shared-key');
    assert.equal(agents.f.apiKey, 'one-shared-key');
    assert.equal(agents.e.baseUrl, 'https://api.proxyllm.eu/v1');
    assert.equal(agents.f.baseUrl, 'https://api.proxyllm.eu/v1');

    const publicConfig = getPublicConfig();
    assert.deepEqual(publicConfig.agentSlots, SIX);
    assert.equal(publicConfig.agents.e.configured, true);
    assert.equal(publicConfig.agents.f.configured, true);
    assert.equal(publicConfig.agents.e.optional, true);
    assert.equal(publicConfig.agents.f.optional, true);
  } finally {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name];
      else process.env[name] = previous[name];
    }
  }
});

test('turn scheduler gives all six configured agents a turn', async () => {
  const room = new MultiAgentRoom({
    agents: mockAgents(),
    hardTurnLimit: 20,
    contextConfig: { summarizeAfter: 100 },
    providerFactory: (config) => ({
      async streamChat({ onDelta }) {
        const text = `reply-${config.id}`;
        onDelta?.(text);
        return {
          text,
          toolCalls: [],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, exact: true },
        };
      },
    }),
  });
  const done = completion(room);

  await room.start({
    topicMode: 'manual',
    topic: 'six-agent scheduling',
    conversationMode: 'turns',
    maxTurns: 6,
    startSpeaker: 'a',
    sharedPrompt: 'Talk.',
  });
  const state = await done;

  assert.deepEqual(state.activeAgents, SIX);
  assert.deepEqual(state.history.filter((item) => SIX.includes(item.speaker)).map((item) => item.speaker), SIX);
  for (const id of SIX) assert.equal(state.stats[id].turns, 1);
});

test('private context isolation and fan-out recipient list extend through E/F', () => {
  const room = new ProfiledRoom({
    agents: mockAgents(),
    providerFactory: (config) => ({
      config,
      async streamChat() {
        return { text: 'ok', toolCalls: [], usage: null };
      },
    }),
    contextConfig: { summarizeAfter: 100 },
  });

  const recipients = room.privateToolForAgent('a').function.parameters.properties.recipient.enum;
  assert.deepEqual(recipients, ['b', 'c', 'd', 'e', 'f']);

  room.recordPrivateContext('e', 'f', 'secret-ef');
  assert.match(room.privateContextDataBlock('e'), /secret-ef/);
  assert.match(room.privateContextDataBlock('f'), /secret-ef/);
  assert.doesNotMatch(room.privateContextDataBlock('a'), /secret-ef/);
});

test('history resume accounting counts E/F as AI turns', () => {
  assert.equal(countHistoryAiTurns([
    { speaker: 'a' },
    { speaker: 'e' },
    { speaker: 'user' },
    { speaker: 'f' },
    { speaker: 'tool' },
  ]), 3);
});

test('six-agent UI and markdown surfaces include E/F', async () => {
  const [session, extension, markdown, lab] = await Promise.all([
    readFile(new URL('../public/room-session.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/six-agent-ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/markdown-ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/lab-v2.js', import.meta.url), 'utf8'),
  ]);
  assert.match(session, /six-agent-ui\.js/);
  assert.match(session, /'c', 'd', 'e', 'f'/);
  assert.match(extension, /\['e', 'f'\]/);
  assert.match(extension, /agent\$\{upper\}Total/);
  assert.match(markdown, /\.message\.e \.bubble/);
  assert.match(markdown, /\.message\.f \.bubble/);
  assert.match(lab, /countHistoryAiTurns\(history\)/);
  assert.match(lab, /config\?\.agentSlots/);
});
