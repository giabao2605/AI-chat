import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDeletedHistoryRunIds,
  createHistoryRecord,
  filterDeletedHistory,
  parseDeletedHistory,
  parseStoredHistory,
  removeHistoryRecord,
  upsertHistory,
} from '../public/history.js';

const snapshot = (overrides = {}) => ({
  runId: 'run-1', topic: 'Chủ đề test', status: 'running', turn: 1, maxTurns: 20,
  history: [{ id: 'm1', speaker: 'a', name: 'A', text: 'xin chào' }],
  stats: { a: { totalTokens: 12 }, b: { totalTokens: 0 } }, ...overrides,
});

test('history record requires a real topic and at least one message', () => {
  assert.equal(createHistoryRecord(snapshot({ history: [] })), null);
  assert.equal(createHistoryRecord(snapshot({ topic: '' })), null);
  assert.equal(createHistoryRecord(snapshot()).runId, 'run-1');
});

test('upsert replaces the same run instead of duplicating it', () => {
  const first = upsertHistory([], snapshot(), '2026-09-10T08:00:00.000Z');
  const second = upsertHistory(first, snapshot({ turn: 2, history: [...snapshot().history, { id: 'm2', speaker: 'b', name: 'B', text: 'chào lại' }] }), '2026-09-10T08:01:00.000Z');
  assert.equal(second.length, 1);
  assert.equal(second[0].turn, 2);
  assert.equal(second[0].history.length, 2);
});

test('history keeps newest sessions first and respects the limit', () => {
  let records = [];
  for (let i = 0; i < 4; i += 1) records = upsertHistory(records, snapshot({ runId: `run-${i}`, topic: `topic ${i}` }), `2026-09-10T08:0${i}:00.000Z`, 3);
  assert.deepEqual(records.map((item) => item.runId), ['run-3', 'run-2', 'run-1']);
});

test('parseStoredHistory survives corrupted localStorage data', () => {
  assert.deepEqual(parseStoredHistory('{broken'), []);
  assert.equal(parseStoredHistory(JSON.stringify([createHistoryRecord(snapshot())])).length, 1);
});

test('removeHistoryRecord deletes only the selected run', () => {
  const records = [createHistoryRecord(snapshot()), createHistoryRecord(snapshot({ runId: 'run-2', topic: 'khác' }))];
  assert.deepEqual(removeHistoryRecord(records, 'run-1').map((item) => item.runId), ['run-2']);
});

test('deleted run tombstone prevents realtime state from resurrecting history', () => {
  const deleted = addDeletedHistoryRunIds([], ['run-1']);
  const next = upsertHistory([], snapshot(), '2026-09-10T08:05:00.000Z', 50, deleted);
  assert.deepEqual(next, []);

  const fresh = upsertHistory([], snapshot({ runId: 'run-2', topic: 'phiên mới' }), '2026-09-10T08:06:00.000Z', 50, deleted);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].runId, 'run-2');
});

test('deleted history ids persist safely, deduplicate and filter stale records', () => {
  const deleted = addDeletedHistoryRunIds(['run-1'], ['run-2', 'run-1']);
  assert.deepEqual(deleted, ['run-2', 'run-1']);
  assert.deepEqual(parseDeletedHistory(JSON.stringify(deleted)), deleted);
  assert.deepEqual(parseDeletedHistory('{broken'), []);

  const records = [
    createHistoryRecord(snapshot()),
    createHistoryRecord(snapshot({ runId: 'run-2', topic: 'khác' })),
    createHistoryRecord(snapshot({ runId: 'run-3', topic: 'còn lại' })),
  ];
  assert.deepEqual(filterDeletedHistory(records, deleted).map((item) => item.runId), ['run-3']);
});
