import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHistoryRecord } from '../public/history.js';
import { scenarioStatusText } from '../public/scenario-ui.js';

const snapshot = {
  runId: 'run-game',
  topic: 'Ma Sói test',
  status: 'completed',
  conversationMode: 'turns',
  turn: 8,
  maxTurns: 20,
  history: [{ id: 'm1', speaker: 'a', name: 'A', text: 'Tôi nghi B.' }],
  stats: {},
  endedBy: 'scenario',
  endReason: 'Phe Dân Làng thắng.',
  scenario: {
    id: 'werewolf',
    version: '1',
    phase: 'completed',
    stateVersion: 12,
    active: false,
    resumeSupported: false,
    state: {
      phase: 'completed',
      day: 2,
      alive: ['a', 'c'],
      dead: ['b', 'd'],
      winner: 'village',
      events: [{ id: 'e9', day: 2, type: 'victory', winner: 'village' }],
    },
  },
};

test('history persists a cloned public scenario snapshot and end metadata', () => {
  const record = createHistoryRecord(snapshot, '2026-09-16T00:00:00.000Z');
  assert.equal(record.scenario.id, 'werewolf');
  assert.equal(record.scenario.state.winner, 'village');
  assert.equal(record.endedBy, 'scenario');
  assert.equal(record.endReason, 'Phe Dân Làng thắng.');
  snapshot.scenario.state.alive.push('z');
  assert.deepEqual(record.scenario.state.alive, ['a', 'c']);
  snapshot.scenario.state.alive.pop();
});

test('public scenario formatter renders phase, alive/dead and victory without role data', () => {
  const text = scenarioStatusText(snapshot.scenario, { a: 'Alpha', b: 'Beta', c: 'Gamma', d: 'Delta' });
  assert.match(text, /Ma Sói · Kết thúc · Ngày 2/);
  assert.match(text, /Còn sống: Alpha, Gamma/);
  assert.match(text, /Đã chết: Beta, Delta/);
  assert.match(text, /Phe Dân Làng thắng/);
  assert.doesNotMatch(text, /role|seer|doctor|werewolf/);
});

test('scenario UI exposes Werewolf selector and only public-state surfaces', async () => {
  const [index, roomSession, ui, history] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/room-session.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/scenario-ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/history.js', import.meta.url), 'utf8'),
  ]);

  assert.match(index, /id="scenarioMode"/);
  assert.match(index, /option value="werewolf">Ma Sói/);
  assert.match(index, /id="scenarioStatus"/);
  assert.match(index, /src="\/scenario-ui\.js"/);
  assert.match(index, /href="\/scenario-ui\.css"/);

  assert.match(roomSession, /body\.scenarioId = scenarioId/);
  assert.match(roomSession, /body\.conversationMode = 'turns'/);
  assert.match(roomSession, /body\.topicMode = 'manual'/);
  assert.doesNotMatch(roomSession, /scenarioId.*continue/s);

  assert.match(ui, /configuredCount < 4/);
  assert.match(ui, /scenario\.state/);
  assert.match(ui, /scenarioForMessage/);
  assert.match(ui, /button\.remove\(\)/);
  assert.doesNotMatch(ui, /scenario_private_state|privateContextFor|rolesByAgent|\.roles\b/);

  assert.match(history, /scenario: snapshot\.scenario \? clone\(snapshot\.scenario\) : null/);
});
