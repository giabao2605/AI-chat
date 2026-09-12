import { normalizeRoomId } from './room-manager.js';

export function resolveRequestRoomId({
  multiRoomEnabled = true,
  queryRoomId = '',
  headerRoomId = '',
} = {}) {
  if (!multiRoomEnabled) return 'default-room';
  return normalizeRoomId(queryRoomId || headerRoomId || 'default-room');
}
