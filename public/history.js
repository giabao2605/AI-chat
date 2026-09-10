export const HISTORY_STORAGE_KEY = 'ai-chat-history-v1';
export const HISTORY_LIMIT = 50;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createHistoryRecord(snapshot, savedAt = new Date().toISOString()) {
  if (!snapshot?.runId || !snapshot?.topic || !Array.isArray(snapshot.history) || snapshot.history.length === 0) return null;
  return {
    runId: snapshot.runId,
    topic: snapshot.topic,
    status: snapshot.status || 'unknown',
    turn: Number(snapshot.turn || 0),
    maxTurns: Number(snapshot.maxTurns || 0),
    history: clone(snapshot.history),
    stats: clone(snapshot.stats || {}),
    savedAt,
  };
}

export function upsertHistory(records, snapshot, savedAt = new Date().toISOString(), limit = HISTORY_LIMIT) {
  const record = createHistoryRecord(snapshot, savedAt);
  if (!record) return Array.isArray(records) ? records : [];
  const source = Array.isArray(records) ? records : [];
  return [record, ...source.filter((item) => item?.runId !== record.runId)]
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
