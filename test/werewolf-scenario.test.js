import test from 'node:test';
import assert from 'node:assert/strict';
import { ScenarioController } from '../src/scenario.js';
import { WEREWOLF_ROLES, WEREWOLF_SCENARIO } from '../src/werewolf-scenario.js';

const ids4 = ['a', 'b', 'c', 'd'];
const roles4 = {
  a: WEREWOLF_ROLES.WEREWOLF,
  b: WEREWOLF_ROLES.SEER,
  c: WEREWOLF_ROLES.DOCTOR,
  d: WEREWOLF_ROLES.VILLAGER,
};

function game(agentIds = ids4, rolesByAgent = roles4, seed = 'test-seed') {
  return new ScenarioController({
    definition: WEREWOLF_SCENARIO,
    agentIds,
    options: { seed, rolesByAgent },
  });
}

function finishNight(controller, { kill = 'd', inspect = 'a', protect = 'b' } = {}) {
  controller.applyAction('a', kill ? { type: 'wolf_kill', target: kill } : { type: 'pass' });
  controller.applyAction('b', inspect ? { type: 'seer_inspect', target: inspect } : { type: 'pass' });
  controller.applyAction('c', protect ? { type: 'doctor_protect', target: protect } : { type: 'pass' });
}

function finishDiscussion(controller) {
  for (const id of [...controller.eligibleSpeakers()]) controller.onPublicMessage(id, { text: `speech-${id}` });
}

test('seeded role assignment is deterministic for 4/5/6 agents', () => {
  for (const count of [4, 5, 6]) {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'].slice(0, count);
    const left = new ScenarioController({ definition: WEREWOLF_SCENARIO, agentIds: ids, options: { seed: `seed-${count}` } });
    const right = new ScenarioController({ definition: WEREWOLF_SCENARIO, agentIds: ids, options: { seed: `seed-${count}` } });
    assert.deepEqual(left.result().roles, right.result().roles);
    assert.equal(left.phase, 'night');
  }
});

test('public state never exposes role assignment or seer result', () => {
  const controller = game();
  const serialized = JSON.stringify(controller.publicSnapshot());
  assert.equal(serialized.includes('werewolf'), false);
  assert.equal(serialized.includes('seer'), false);
  assert.equal(serialized.includes('doctor'), false);

  controller.applyAction('b', { type: 'seer_inspect', target: 'a' });
  assert.match(controller.privateContextFor('b'), /A = Ma Sói/);
  assert.equal(JSON.stringify(controller.publicSnapshot()).includes('Ma Sói'), false);
});

test('night actions are role-gated and backend rejects invalid target/action pairs', () => {
  const controller = game();
  assert.deepEqual(controller.eligibleSpeakers(), ['a', 'b', 'c']);
  assert.deepEqual(controller.legalActionsFor('d'), []);
  assert.throws(() => controller.applyAction('d', { type: 'wolf_kill', target: 'a' }), /không hợp lệ/);
  assert.throws(() => controller.applyAction('a', { type: 'wolf_kill', target: 'a' }), /không hợp lệ/);
  assert.throws(() => controller.applyAction('b', { type: 'doctor_protect', target: 'b' }), /không hợp lệ/);
});

test('doctor protection prevents the wolf kill while seer result stays private', () => {
  const controller = game();
  finishNight(controller, { kill: 'd', inspect: 'a', protect: 'd' });
  assert.equal(controller.phase, 'day_discussion');
  assert.deepEqual(controller.publicState().alive, ids4);
  assert.match(controller.privateContextFor('b'), /A = Ma Sói/);
  assert.equal(controller.publicState().events.at(-2)?.type === 'night_safe' || controller.publicState().events.at(-1)?.type === 'night_safe', true);
});

test('unprotected night target dies and dead agents are gated from discussion', () => {
  const controller = game();
  finishNight(controller, { kill: 'd', inspect: 'a', protect: 'b' });
  assert.equal(controller.phase, 'day_discussion');
  assert.deepEqual(controller.publicState().dead, ['d']);
  assert.deepEqual(controller.eligibleSpeakers(), ['a', 'b', 'c']);
});

test('day vote tie eliminates nobody and advances to the next night', () => {
  const controller = game();
  finishNight(controller, { kill: null, inspect: 'a', protect: 'b' });
  finishDiscussion(controller);
  assert.equal(controller.phase, 'day_vote');
  controller.applyAction('a', { type: 'vote', target: 'b' });
  controller.applyAction('b', { type: 'vote', target: 'a' });
  controller.applyAction('c', { type: 'vote', target: 'd' });
  controller.applyAction('d', { type: 'pass' });
  assert.equal(controller.phase, 'night');
  assert.equal(controller.publicState().day, 2);
  assert.deepEqual(controller.publicState().dead, []);
  assert.equal(controller.publicState().events.some((event) => event.type === 'vote_tie'), true);
});

test('backend declares wolves victory when wolves reach parity', () => {
  const controller = game();
  finishNight(controller, { kill: 'd', inspect: 'a', protect: 'b' });
  finishDiscussion(controller);
  controller.applyAction('a', { type: 'vote', target: 'c' });
  controller.applyAction('b', { type: 'vote', target: 'c' });
  controller.applyAction('c', { type: 'vote', target: 'a' });
  assert.equal(controller.isComplete(), true);
  assert.equal(controller.publicState().winner, 'wolves');
  assert.deepEqual(controller.publicState().dead.sort(), ['c', 'd']);
});

test('backend declares village victory when the last wolf is eliminated', () => {
  const controller = game();
  finishNight(controller, { kill: null, inspect: 'a', protect: 'b' });
  finishDiscussion(controller);
  controller.applyAction('a', { type: 'vote', target: 'b' });
  controller.applyAction('b', { type: 'vote', target: 'a' });
  controller.applyAction('c', { type: 'vote', target: 'a' });
  controller.applyAction('d', { type: 'vote', target: 'a' });
  assert.equal(controller.isComplete(), true);
  assert.equal(controller.publicState().winner, 'village');
  assert.deepEqual(controller.publicState().dead, ['a']);
});
