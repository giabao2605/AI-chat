export const CONTROL_SETTINGS_STORAGE_KEY = 'ai-chat-control-settings-v1';

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function clampInteger(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}

function normalizeConversationMode(value, fallback = 'turns') {
  if (value === 'parallel') return 'parallel';
  if (value === 'turns') return 'turns';
  return fallback === 'parallel' ? 'parallel' : 'turns';
}

export function createControlSettings(values = {}, fallback = {}, savedAt = new Date().toISOString()) {
  const fallbackMaxTurns = clampInteger(fallback.maxTurns, 1, 200, 20);
  const fallbackTemperature = clampNumber(fallback.temperature, 0, 2, 0.8);
  const fallbackMaxOutputTokens = clampInteger(fallback.maxOutputTokens, 64, 16000, 1200);
  const fallbackSpeaker = ['random', 'a', 'b'].includes(fallback.startSpeaker) ? fallback.startSpeaker : 'random';
  const fallbackConversationMode = normalizeConversationMode(fallback.conversationMode, 'turns');

  return {
    conversationMode: normalizeConversationMode(values.conversationMode, fallbackConversationMode),
    maxTurns: clampInteger(values.maxTurns, 1, 200, fallbackMaxTurns),
    temperature: clampNumber(values.temperature, 0, 2, fallbackTemperature),
    maxOutputTokens: clampInteger(values.maxOutputTokens, 64, 16000, fallbackMaxOutputTokens),
    startSpeaker: ['random', 'a', 'b'].includes(values.startSpeaker) ? values.startSpeaker : fallbackSpeaker,
    savedAt,
  };
}

export function parseStoredControlSettings(raw, fallback = {}) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (!('maxTurns' in parsed) || !('temperature' in parsed) || !('maxOutputTokens' in parsed) || !('startSpeaker' in parsed)) return null;
    return createControlSettings(parsed, fallback, typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date(0).toISOString());
  } catch {
    return null;
  }
}

export function controlSettingsEqual(a, b) {
  if (!a || !b) return false;
  return a.conversationMode === b.conversationMode
    && Number(a.maxTurns) === Number(b.maxTurns)
    && Number(a.temperature) === Number(b.temperature)
    && Number(a.maxOutputTokens) === Number(b.maxOutputTokens)
    && a.startSpeaker === b.startSpeaker;
}
