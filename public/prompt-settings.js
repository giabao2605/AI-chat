export const PROMPT_SETTINGS_STORAGE_KEY = 'ai-chat-prompt-settings-v1';

function text(value) {
  return typeof value === 'string' ? value : '';
}

export function createPromptSettings(values = {}, savedAt = new Date().toISOString()) {
  return {
    sharedPrompt: text(values.sharedPrompt),
    personaA: text(values.personaA),
    personaB: text(values.personaB),
    savedAt,
  };
}

export function parseStoredPromptSettings(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (typeof parsed.sharedPrompt !== 'string' || typeof parsed.personaA !== 'string' || typeof parsed.personaB !== 'string') return null;
    return createPromptSettings(parsed, typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date(0).toISOString());
  } catch {
    return null;
  }
}

export function promptSettingsEqual(a, b) {
  if (!a || !b) return false;
  return text(a.sharedPrompt) === text(b.sharedPrompt)
    && text(a.personaA) === text(b.personaA)
    && text(a.personaB) === text(b.personaB);
}
