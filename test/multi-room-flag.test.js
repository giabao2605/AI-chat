import test from 'node:test';
import assert from 'node:assert/strict';
import { getServerConfig } from '../src/config.js';
import { resolveRequestRoomId } from '../src/room-routing.js';

function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try { return fn(); }
  finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

test('multi-room remains enabled by default for backward compatibility', () => {
  withEnv('MULTI_ROOM_ENABLED', undefined, () => {
    assert.equal(getServerConfig().multiRoomEnabled, true);
  });
});

test('MULTI_ROOM_ENABLED=false disables multi-room routing', () => {
  withEnv('MULTI_ROOM_ENABLED', 'false', () => {
    assert.equal(getServerConfig().multiRoomEnabled, false);
  });
});

test('disabled multi-room forces every request into default-room', () => {
  assert.equal(resolveRequestRoomId({
    multiRoomEnabled: false,
    queryRoomId: 'room_from_query',
    headerRoomId: 'room_from_header',
  }), 'default-room');
});

test('enabled multi-room keeps query/header routing behavior', () => {
  assert.equal(resolveRequestRoomId({
    multiRoomEnabled: true,
    queryRoomId: 'room_query',
    headerRoomId: 'room_header',
  }), 'room_query');
  assert.equal(resolveRequestRoomId({
    multiRoomEnabled: true,
    headerRoomId: 'room_header',
  }), 'room_header');
  assert.equal(resolveRequestRoomId({ multiRoomEnabled: true }), 'default-room');
});
