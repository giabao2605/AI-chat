const ROOM_KEY = 'ai-chat-room-id-v2';
const EXTRA_PERSONAS_KEY = 'ai-chat-extra-personas-v1';
const HISTORY_KEY = 'ai-chat-history-v1';
const DB_NAME = 'ai-chat-lab-v2';
const DB_VERSION = 1;

function makeRoomId() {
  const raw = globalThis.crypto?.randomUUID?.().replace(/-/g, '') || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `room_${raw}`;
}

const roomId = sessionStorage.getItem(ROOM_KEY) || makeRoomId();
sessionStorage.setItem(ROOM_KEY, roomId);
window.__AI_CHAT_ROOM_ID__ = roomId;

function openDb() {
  if (!('indexedDB' in window)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'runId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function dbGet(store, key) {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => resolve(null);
  });
}

async function restoreHistoryFromDb() {
  if (localStorage.getItem(HISTORY_KEY)) return;
  const backup = await dbGet('kv', 'history-backup');
  if (typeof backup === 'string' && backup.startsWith('[')) {
    try { localStorage.setItem(HISTORY_KEY, backup); } catch {}
  }
}

void restoreHistoryFromDb();

function appendRoom(value) {
  try {
    const url = new URL(String(value), location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
      if (!url.searchParams.has('room')) url.searchParams.set('room', roomId);
      return `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {}
  return value;
}

function readExtraPersonas() {
  try {
    const parsed = JSON.parse(localStorage.getItem(EXTRA_PERSONAS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function augmentBody(input, init = {}) {
  const path = typeof input === 'string' ? input : input?.url;
  if (!path || !/\/api\/(?:start|continue)(?:\?|$)/.test(path) || typeof init.body !== 'string') return init;
  try {
    const body = JSON.parse(init.body);
    const extra = readExtraPersonas();
    body.personaC = document.getElementById('personaC')?.value ?? extra.c ?? '';
    body.personaD = document.getElementById('personaD')?.value ?? extra.d ?? '';
    return { ...init, body: JSON.stringify(body) };
  } catch {
    return init;
  }
}

const nativeFetch = window.fetch.bind(window);
window.fetch = function patchedFetch(input, init = {}) {
  const nextInit = augmentBody(input, init);
  if (typeof input === 'string' || input instanceof URL) return nativeFetch(appendRoom(input), nextInit);
  if (input instanceof Request) {
    const next = new Request(appendRoom(input.url), input);
    return nativeFetch(next, nextInit);
  }
  return nativeFetch(input, nextInit);
};

const NativeEventSource = window.EventSource;
window.EventSource = class RoomEventSource extends NativeEventSource {
  constructor(url, options) {
    super(appendRoom(url), options);
  }
};

window.__AI_CHAT_DB__ = { openDb, dbGet, name: DB_NAME, extraPersonasKey: EXTRA_PERSONAS_KEY };
