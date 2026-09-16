import test from 'node:test';
import assert from 'node:assert/strict';
import { ScenarioController } from '../src/scenario.js';
import { ScenarioRoom } from '../src/scenario-room.js';
import { WEREWOLF_ROLES, WEREWOLF_SCENARIO } from '../src/werewolf-scenario.js';

const agents = Object.fromEntries(['a', 'b', 'c', 'd'].map((id) => [id, {
  id,
  name: `Luna ${id.toUpperCase()}`,
  apiKey: `key-${id}`,
  model: 'mock',
  baseUrl: 'http://mock',
}]));

function usage() {
  return { inputTokens: 1, outputTokens: 1, totalTokens: 2, exact: true };
}

function waitForTerminal(room, timeoutMs = 3000) {
  if (['completed', 'error', 'stopped'].includes(room.status)) return Promise.resolve(room.snapshot());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      room.off('state', onState);
      reject(new Error(`Room did not terminate. status=${room.status} phase=${room.scenarioController?.phase}`));
    }, timeoutMs);
    const onState = (snapshot) => {
      if (!['completed', 'error', 'stopped'].includes(snapshot.status)) return;
      clearTimeout(timer);
      room.off('state', onState);
      resolve(snapshot);
    };
    room.on('state', onState);
  });
}

function roleLabel(role) {
  return ({
    [WEREWOLF_ROLES.WEREWOLF]: 'Ma Sói',
    [WEREWOLF_ROLES.SEER]: 'Tiên Tri',
    [WEREWOLF_ROLES.DOCTOR]: 'Bác Sĩ',
    [WEREWOLF_ROLES.VILLAGER]: 'Dân Làng',
  })[role];
}

test('Werewolf room runs backend-gated hidden actions to deterministic victory without public secret leakage', async () => {
  const captured = Object.fromEntries(Object.keys(agents).map((id) => [id, []]));
  const secretPhaseSnapshots = [];
  let room;

  const providerFactory = (config) => ({
    async streamChat({ messages = [], tools = [], onDelta = () => {} }) {
      captured[config.id].push(structuredClone(messages));
      const scenarioTool = tools.find((tool) => tool?.function?.name === 'scenario_action');
      if (scenarioTool) {
        const roles = room.scenarioController.result().roles;
        const role = roles[config.id];
        const properties = scenarioTool.function.parameters.properties;
        const actionTypes = properties.action.enum || [];
        const targets = properties.target?.enum || [];
        let action = 'pass';
        let target = '';

        if (actionTypes.includes('wolf_kill')) {
          action = 'wolf_kill';
          target = targets.find((id) => roles[id] === WEREWOLF_ROLES.VILLAGER) || targets[0];
        } else if (actionTypes.includes('seer_inspect')) {
          action = 'seer_inspect';
          target = targets.find((id) => roles[id] === WEREWOLF_ROLES.WEREWOLF) || targets[0];
        } else if (actionTypes.includes('doctor_protect')) {
          action = 'doctor_protect';
          target = targets.includes(config.id) ? config.id : targets[0];
        } else if (actionTypes.includes('vote')) {
          action = 'vote';
          target = role === WEREWOLF_ROLES.WEREWOLF
            ? targets[0]
            : (targets.find((id) => roles[id] === WEREWOLF_ROLES.WEREWOLF) || targets[0]);
        }

        return {
          text: '',
          usage: usage(),
          toolCalls: [{
            id: `scenario-${config.id}`,
            type: 'function',
            function: { name: 'scenario_action', arguments: JSON.stringify({ action, ...(target ? { target } : {}) }) },
          }],
        };
      }

      const text = `public-speech-${config.id}`;
      onDelta(text);
      return { text, usage: usage(), toolCalls: [] };
    },
  });

  room = new ScenarioRoom({
    agents,
    providerFactory,
    hardTurnLimit: 30,
    scenarioSeedFactory: () => 'runtime-fixed-seed',
    contextConfig: { summarizeAfter: 100 },
  });
  room.on('state', (snapshot) => {
    if (snapshot.scenario?.phase === 'night') secretPhaseSnapshots.push(structuredClone(snapshot));
  });

  const terminal = waitForTerminal(room);
  await room.start({
    scenarioId: 'werewolf',
    topic: 'Ma Sói runtime isolation test',
    maxTurns: 20,
    startSpeaker: 'a',
    conversationMode: 'turns',
  });
  const snapshot = await terminal;

  assert.equal(snapshot.status, 'completed');
  assert.equal(snapshot.endedBy, 'scenario');
  assert.equal(snapshot.scenario.id, 'werewolf');
  assert.equal(snapshot.scenario.state.winner, 'village');
  assert.ok(secretPhaseSnapshots.length > 0);
  assert.equal(secretPhaseSnapshots.every((state) => state.currentSpeaker == null && state.currentSpeakers.length === 0), true);

  const roles = room.scenarioController.result().roles;
  let agentsThatReceivedScenarioContext = 0;
  for (const [id, role] of Object.entries(roles)) {
    if (!captured[id].length) continue;
    agentsThatReceivedScenarioContext += 1;
    const payload = JSON.stringify(captured[id]);
    assert.match(payload, new RegExp(`Vai trò bí mật của bạn: ${roleLabel(role)}`));
    for (const [otherId, otherRole] of Object.entries(roles)) {
      if (otherId === id || otherRole === role) continue;
      assert.doesNotMatch(payload, new RegExp(`Vai trò bí mật của bạn: ${roleLabel(otherRole)}`));
    }
  }
  assert.ok(agentsThatReceivedScenarioContext >= 3, 'alive/special agents should receive isolated scenario context');

  const publicSerialized = JSON.stringify({
    history: snapshot.history,
    debugEvents: snapshot.debugEvents,
    scenario: snapshot.scenario,
  });
  assert.doesNotMatch(publicSerialized, /scenario_private_state/);
  assert.doesNotMatch(publicSerialized, /Vai trò bí mật của bạn/);
  for (const [id, role] of Object.entries(roles)) {
    assert.equal(publicSerialized.includes(`\"${id}\":\"${role}\"`), false);
  }
  assert.equal(snapshot.history.every((entry) => String(entry.text || '').startsWith('public-speech-')), true);
});

test('scenario context is injected only after research planning so secret roles never reach the planner', async () => {
  const plannerPayloads = [];
  const providerFactory = () => ({
    async streamChat({ messages = [] }) {
      plannerPayloads.push(structuredClone(messages));
      return {
        text: JSON.stringify({ search: false, queries: [], freshness: '', reason: 'not-needed' }),
        usage: usage(),
        toolCalls: [],
      };
    },
  });
  const room = new ScenarioRoom({
    agents,
    providerFactory,
    webSearch: { searchMany: async () => [] },
    contextConfig: { summarizeAfter: 100 },
  });
  room.scenarioController = new ScenarioController({
    definition: WEREWOLF_SCENARIO,
    agentIds: Object.keys(agents),
    options: {
      rolesByAgent: {
        a: WEREWOLF_ROLES.WEREWOLF,
        b: WEREWOLF_ROLES.SEER,
        c: WEREWOLF_ROLES.DOCTOR,
        d: WEREWOLF_ROLES.VILLAGER,
      },
    },
  });
  room.topic = 'Phiên bản này có thực sự đáng tin không?';
  room.history = [];
  room.createProviders();
  const messages = [
    { role: 'system', content: 'public system' },
    { role: 'user', content: 'public question' },
  ];

  await room.addWebResearch('a', messages, new AbortController().signal, []);

  assert.equal(plannerPayloads.length, 1);
  const plannerText = JSON.stringify(plannerPayloads[0]);
  assert.doesNotMatch(plannerText, /scenario_private_state|Vai trò bí mật|Ma Sói/);
  const finalText = JSON.stringify(messages);
  assert.match(finalText, /scenario_private_state/);
  assert.match(finalText, /Vai trò bí mật của bạn: Ma Sói/);
});

test('scenario resume/fork is rejected instead of restoring an unsafe partial secret state', async () => {
  const room = new ScenarioRoom({
    agents,
    providerFactory: () => ({ streamChat: async () => ({ text: 'unused', usage: usage(), toolCalls: [] }) }),
  });
  await assert.rejects(() => room.continueFromHistory({
    session: {
      status: 'stopped',
      topic: 'old game',
      history: [{ id: 'm1', speaker: 'a', name: 'A', text: 'x' }],
      scenario: { id: 'werewolf', version: '1', state: { phase: 'day_discussion' } },
    },
  }), (error) => error?.code === 'SCENARIO_RESUME_UNSUPPORTED');
});

test('failed hidden action provider call does not mutate scenario state', async () => {
  let room;
  const providerFactory = () => ({
    async streamChat() {
      throw new Error('provider exploded');
    },
  });
  room = new ScenarioRoom({
    agents,
    providerFactory,
    hardTurnLimit: 20,
    scenarioSeedFactory: () => 'failure-seed',
  });
  room.on('error', () => {});
  const terminal = waitForTerminal(room);
  await room.start({ scenarioId: 'werewolf', topic: 'failure test', maxTurns: 20, conversationMode: 'turns' });
  const versionAfterStart = room.scenarioController.stateVersion;
  const snapshot = await terminal;
  assert.equal(snapshot.status, 'error');
  assert.equal(room.scenarioController.stateVersion, versionAfterStart);
  assert.equal(room.scenarioController.phase, 'night');
  assert.deepEqual(room.scenarioController.publicState().dead, []);
});
