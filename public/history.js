export const HISTORY_STORAGE_KEY = 'ai-chat-history-v1';
export const HISTORY_DELETED_STORAGE_KEY = 'ai-chat-history-deleted-v1';
export const HISTORY_LIMIT = 50;
export const HISTORY_DELETED_LIMIT = 200;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizedRunIds(values, limit = HISTORY_DELETED_LIMIT) {
  const source = Array.isArray(values) ? values : [];
  const unique = [];
  const seen = new Set();
  for (const value of source) {
    const runId = String(value || '').trim();
    if (!runId || seen.has(runId)) continue;
    seen.add(runId);
    unique.push(runId);
    if (unique.length >= Math.max(1, limit)) break;
  }
  return unique;
}

export function createHistoryRecord(snapshot, savedAt = new Date().toISOString()) {
  if (!snapshot?.runId || !snapshot?.topic || !Array.isArray(snapshot.history) || snapshot.history.length === 0) return null;
  return {
    runId: snapshot.runId,
    topic: snapshot.topic,
    status: snapshot.status || 'unknown',
    conversationMode: snapshot.conversationMode === 'parallel' ? 'parallel' : 'turns',
    turn: Number(snapshot.turn || 0),
    maxTurns: Number(snapshot.maxTurns || 0),
    history: clone(snapshot.history),
    stats: clone(snapshot.stats || {}),
    savedAt,
  };
}

export function upsertHistory(records, snapshot, savedAt = new Date().toISOString(), limit = HISTORY_LIMIT, deletedRunIds = []) {
  const record = createHistoryRecord(snapshot, savedAt);
  if (!record) return Array.isArray(records) ? records : [];
  const source = Array.isArray(records) ? records : [];
  const deleted = new Set(normalizedRunIds(deletedRunIds));
  if (deleted.has(record.runId)) return source;
  return [record, ...source.filter((item) => item?.runId !== record.runId && !deleted.has(item?.runId))]
    .sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))
    .slice(0, Math.max(1, limit));
}

export function removeHistoryRecord(records, runId) {
  return (Array.isArray(records) ? records : []).filter((item) => item?.runId !== runId);
}

export function parseStoredHistory(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => item?.runId && item?.topic && Array.isArray(item?.history)) : [];
  } catch {
    return [];
  }
}

export function parseDeletedHistory(raw, limit = HISTORY_DELETED_LIMIT) {
  if (!raw) return [];
  try {
    return normalizedRunIds(JSON.parse(raw), limit);
  } catch {
    return [];
  }
}

export function addDeletedHistoryRunIds(existing, runIds, limit = HISTORY_DELETED_LIMIT) {
  const next = Array.isArray(runIds) ? runIds : [runIds];
  return normalizedRunIds([...next, ...(Array.isArray(existing) ? existing : [])], limit);
}

export function filterDeletedHistory(records, deletedRunIds = []) {
  const deleted = new Set(normalizedRunIds(deletedRunIds));
  return (Array.isArray(records) ? records : []).filter((item) => item?.runId && !deleted.has(item.runId));
}
