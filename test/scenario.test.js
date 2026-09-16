import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ScenarioController,
  buildScenarioActionTool,
  createSeededRng,
  parseScenarioActionToolCall,
  scenarioContextBlocks,
} from '../src/scenario.js';

const definition = {
  id: 'test-scenario',
  version: '1',
  minimumPlayers: 2,
  maximumPlayers: 3,
  initialize(agentIds) {
    return { phase: 'action', agentIds, acted: {}, secrets: Object.fromEntries(agentIds.map((id) => [id, `secret-${id}`])) };
  },
  publicState(state) { return { phase: state.phase, acted: Object.keys(state.acted).length }; },
  privateContextFor(state, agentId) { return state.secrets[agentId]; },
  legalActionsFor(state, agentId) { return state.acted[agentId] ? [] : [{ type: 'pick', targets: state.agentIds.filter((id) => id !== agentId) }]; },
  eligibleSpeakers(state) { return state.agentIds.filter((id) => !state.acted[id]); },
  applyAction(state, agentId, action) { state.acted[agentId] = action.target; return { type: action.type }; },
  onPublicMessage() { return false; },
  maybeAdvancePhase(state) {
    if (state.agentIds.every((id) => state.acted[id])) { state.phase = 'completed'; return true; }
    return false;
  },
  isComplete(state) { return state.phase === 'completed'; },
  result(state) { return { acted: state.acted, secrets: state.secrets }; },
};

test('seeded RNG is deterministic without requiring global Math.random', () => {
  const a = createSeededRng('same-seed');
  const b = createSeededRng('same-seed');
  assert.deepEqual(Array.from({ length: 8 }, () => a()), Array.from({ length: 8 }, () => b()));
});

test('generic controller exposes public state but keeps private context out of snapshot', () => {
  const controller = new ScenarioController({ definition, agentIds: ['a', 'b'], options: { seed: 'x' } });
  const snapshot = controller.publicSnapshot();
  assert.equal(snapshot.id, 'test-scenario');
  assert.equal(snapshot.phase, 'action');
  assert.equal(JSON.stringify(snapshot).includes('secret-a'), false);
  assert.equal(controller.privateContextFor('a'), 'secret-a');

  const blocks = scenarioContextBlocks(controller, 'a');
  assert.match(blocks.publicBlock, /scenario_public_state/);
  assert.match(blocks.privateBlock, /secret-a/);
  assert.equal(blocks.privateChars, 'secret-a'.length);
});

test('generic controller validates legal actions and advances state deterministically', () => {
  const controller = new ScenarioController({ definition, agentIds: ['a', 'b'] });
  assert.deepEqual(controller.eligibleSpeakers(), ['a', 'b']);
  assert.throws(() => controller.applyAction('a', { type: 'pick', target: 'a' }), /không hợp lệ/);
  controller.applyAction('a', { type: 'pick', target: 'b' });
  assert.deepEqual(controller.eligibleSpeakers(), ['b']);
  controller.applyAction('b', { type: 'pick', target: 'a' });
  assert.equal(controller.isComplete(), true);
  assert.equal(controller.phase, 'completed');
});

test('scenario action tool is dynamic and parser never trusts malformed JSON', () => {
  const controller = new ScenarioController({ definition, agentIds: ['a', 'b'] });
  const tool = buildScenarioActionTool(controller, 'a');
  assert.equal(tool.function.name, 'scenario_action');
  assert.deepEqual(tool.function.parameters.properties.action.enum, ['pick']);
  assert.deepEqual(tool.function.parameters.properties.target.enum, ['b']);

  const parsed = parseScenarioActionToolCall({ function: { name: 'scenario_action', arguments: '{"action":"pick","target":"b"}' } });
  assert.deepEqual(parsed.action, { type: 'pick', target: 'b' });
  assert.equal(parseScenarioActionToolCall({ function: { name: 'scenario_action', arguments: '{' } }).error.length > 0, true);
});
