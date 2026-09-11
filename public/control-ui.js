import { CONTROL_SETTINGS_STORAGE_KEY, createControlSettings, parseStoredControlSettings } from './control-settings.js';

const $ = (id) => document.getElementById(id);
const fields = {
  conversationMode: $('conversationMode'),
  maxTurns: $('maxTurns'),
  temperature: $('temperature'),
  maxOutputTokens: $('maxOutputTokens'),
  startSpeaker: $('startSpeaker'),
};

function current(savedAt = new Date().toISOString()) {
  return createControlSettings({
    conversationMode: fields.conversationMode?.value,
    maxTurns: fields.maxTurns.value,
    temperature: fields.temperature.value,
    maxOutputTokens: fields.maxOutputTokens.value,
    startSpeaker: fields.startSpeaker.value,
  }, {}, savedAt);
}

function apply(settings) {
  if (fields.conversationMode) fields.conversationMode.value = settings.conversationMode;
  fields.maxTurns.value = String(settings.maxTurns);
  fields.temperature.value = String(settings.temperature);
  fields.maxOutputTokens.value = String(settings.maxOutputTokens);
  fields.startSpeaker.value = settings.startSpeaker;
}

function persist() {
  const next = current();
  try {
    localStorage.setItem(CONTROL_SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The form still keeps the current values for this page even if storage is unavailable.
  }
  return next;
}

async function waitForMainApp() {
  for (let i = 0; i < 160; i += 1) {
    const modelReady = $('agentAModel')?.textContent && $('agentAModel').textContent !== '-';
    if (modelReady) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function init() {
  await waitForMainApp();

  // At this point app.js has already applied server defaults. Capture those as the
  // fallback only for browsers that have never saved local tuning before.
  const defaults = current(null);
  const stored = parseStoredControlSettings(localStorage.getItem(CONTROL_SETTINGS_STORAGE_KEY), defaults);
  const active = stored || defaults;
  apply(active);

  // Persist even the first resolved values. Future app releases may change defaults,
  // but this browser keeps the user's current tuning until they explicitly edit it.
  try {
    localStorage.setItem(CONTROL_SETTINGS_STORAGE_KEY, JSON.stringify(active));
  } catch {}

  for (const field of Object.values(fields).filter(Boolean)) {
    field.addEventListener('change', persist);
    field.addEventListener('input', persist);
  }
}

init();
