const ROOM_ID_PATTERN = /^[a-zA-Z0-9_-]{8,120}$/;

export function normalizeRoomId(value, fallback = 'default-room') {
  const id = String(value || '').trim();
  return ROOM_ID_PATTERN.test(id) ? id : fallback;
}

export class RoomManager {
  constructor({ createRoom, maxRooms = 30, roomTtlMs = 12 * 60 * 60 * 1000 } = {}) {
    if (typeof createRoom !== 'function') throw new Error('RoomManager cần createRoom factory.');
    this.createRoom = createRoom;
    this.maxRooms = Math.max(1, Number(maxRooms) || 30);
    this.roomTtlMs = Math.max(60_000, Number(roomTtlMs) || 12 * 60 * 60 * 1000);
    this.rooms = new Map();
  }

  touch(record) {
    if (record) record.lastAccessAt = Date.now();
    return record;
  }

  get(roomId = 'default-room') {
    const id = normalizeRoomId(roomId);
    let record = this.rooms.get(id);
    if (!record) {
      this.evictIfNeeded();
      const room = this.createRoom(id);
      record = { id, room, clients: new Set(), createdAt: Date.now(), lastAccessAt: Date.now() };
      this.rooms.set(id, record);
    }
    return this.touch(record);
  }

  peek(roomId = 'default-room') {
    return this.touch(this.rooms.get(normalizeRoomId(roomId)) || null);
  }

  attachClient(roomId, res) {
    const record = this.get(roomId);
    record.clients.add(res);
    return () => record.clients.delete(res);
  }

  broadcast(roomId, event, payload, send) {
    const record = this.peek(roomId);
    if (!record) return;
    for (const client of record.clients) send(client, event, payload);
  }

  delete(roomId) {
    const id = normalizeRoomId(roomId);
    const record = this.rooms.get(id);
    if (!record) return false;
    try { record.room?.stop?.(); } catch {}
    for (const client of record.clients) {
      try { client.end(); } catch {}
    }
    return this.rooms.delete(id);
  }

  cleanup(now = Date.now()) {
    let removed = 0;
    for (const [id, record] of this.rooms) {
      const active = ['starting', 'running', 'paused', 'pausing'].includes(record.room?.status);
      if (!active && record.clients.size === 0 && now - record.lastAccessAt > this.roomTtlMs) {
        if (this.delete(id)) removed += 1;
      }
    }
    return removed;
  }

  evictIfNeeded() {
    if (this.rooms.size < this.maxRooms) return;
    const candidates = [...this.rooms.values()]
      .filter((record) => record.clients.size === 0 && !['starting', 'running', 'paused', 'pausing'].includes(record.room?.status))
      .sort((a, b) => a.lastAccessAt - b.lastAccessAt);
    if (candidates[0]) this.delete(candidates[0].id);
    if (this.rooms.size >= this.maxRooms) throw new Error(`Đã đạt giới hạn ${this.maxRooms} phòng đang giữ trên server.`);
  }

  stats() {
    return {
      rooms: this.rooms.size,
      clients: [...this.rooms.values()].reduce((sum, record) => sum + record.clients.size, 0),
    };
  }
}
