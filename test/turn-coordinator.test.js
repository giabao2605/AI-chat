import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnCoordinator } from '../src/turn-coordinator.js';

const coordinator = new TurnCoordinator();

test('speaker selection respects configured order, explicit start and scenario eligibility', () => {
  const baseOrder = ['a', 'b', 'c', 'd'];
  assert.equal(coordinator.firstSpeaker({ baseOrder, requested: 'c' }), 'c');
  assert.equal(coordinator.firstSpeaker({ baseOrder, eligibleIds: ['b', 'd'], requested: 'c', randomize: false }), 'b');
  assert.equal(coordinator.nextSpeaker({ baseOrder, eligibleIds: ['b', 'd'], current: 'b' }), 'd');
  assert.equal(coordinator.nextSpeaker({ baseOrder, eligibleIds: ['b', 'd'], current: 'd' }), 'b');
});

test('random first speaker only selects from eligible agents', () => {
  const baseOrder = ['a', 'b', 'c'];
  assert.equal(coordinator.firstSpeaker({ baseOrder, eligibleIds: ['b', 'c'], random: () => 0 }), 'b');
  assert.equal(coordinator.firstSpeaker({ baseOrder, eligibleIds: ['b', 'c'], random: () => 0.999 }), 'c');
});

test('unseen trigger supports index-based and id-set tracking', () => {
  const history = [
    { id: 'm1', speaker: 'a' },
    { id: 'm2', speaker: 'user' },
    { id: 'm3', speaker: 'b' },
  ];
  const relevant = (item) => item.speaker !== 'a';

  assert.equal(coordinator.unseenTrigger({ history, relevant, lastSeenIndex: 0 }), true);
  assert.equal(coordinator.unseenTrigger({ history, relevant, lastSeenIndex: 2 }), false);
  assert.equal(coordinator.unseenTrigger({ history, relevant, seenIds: new Set(['m1', 'm2']) }), true);
  assert.equal(coordinator.unseenTrigger({ history, relevant, seenIds: new Set(['m1', 'm2', 'm3']) }), false);
});

test('parallel order rotates fairly without changing the base order', () => {
  const base = ['c', 'a', 'b'];
  const first = coordinator.rotatedOrder(base, 0);
  const second = coordinator.rotatedOrder(base, first.nextCursor);
  const third = coordinator.rotatedOrder(base, second.nextCursor);

  assert.deepEqual(first.order, ['c', 'a', 'b']);
  assert.deepEqual(second.order, ['a', 'b', 'c']);
  assert.deepEqual(third.order, ['b', 'c', 'a']);
  assert.deepEqual(base, ['c', 'a', 'b']);
});

test('parallel eligibility and limit accounting stay explicit', () => {
  const runtime = { running: false, parallelReserved: false };
  const slots = coordinator.availableParallelSlots({ maxTurns: 5, turn: 3, reservedTurns: 1 });
  assert.equal(slots, 1);
  assert.equal(coordinator.canStartParallel({
    isParallel: true,
    status: 'running',
    runtime,
    availableSlots: slots,
    initial: true,
    historyEmpty: true,
  }), true);
  assert.equal(coordinator.canStartParallel({
    isParallel: true,
    status: 'running',
    runtime: { ...runtime, running: true },
    availableSlots: slots,
    hasUnseenTrigger: true,
  }), false);
  assert.equal(coordinator.limitReached({ status: 'running', turn: 5, maxTurns: 5, runningCount: 0, reservedTurns: 0 }), true);
  assert.equal(coordinator.limitReached({ status: 'running', turn: 5, maxTurns: 5, runningCount: 0, reservedTurns: 1 }), false);
});
