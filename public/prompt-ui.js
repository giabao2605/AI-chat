import { PROMPT_SETTINGS_STORAGE_KEY, createPromptSettings, parseStoredPromptSettings, promptSettingsEqual } from './prompt-settings.js';

const $ = (id) => document.getElementById(id);
const fields = {
  sharedPrompt: $('sharedPrompt'),
  personaA: $('personaA'),
  personaB: $('personaB'),
};
const saveBtn = $('savePromptBtn');
const resetBtn = $('resetPromptBtn');
const status = $('promptSaveStatus');
const startBtn = $('startBtn');
const autoStartKey = 'ai-chat-auto-start';
const resumeAutoStart = localStorage.getItem(autoStartKey) === '1';
if (resumeAutoStart) localStorage.setItem(autoStartKey, '0');

let defaults = createPromptSettings({ sharedPrompt: '', personaA: '', personaB: '' }, null);
let saved = null;
let autoSaveTimer = 0;

function current(savedAt = new Date().toISOString()) {
  return createPromptSettings({
    sharedPrompt: fields.sharedPrompt.value,
    personaA: fields.personaA.value,
    personaB: fields.personaB.value,
  }, savedAt);
}

function formatSavedAt(value) {
  if (!value) return '';
  try { return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
  catch { return ''; }
}

function refreshState() {
  if (!saved) return;
  const dirty = !promptSettingsEqual(current(saved.savedAt), saved);
  saveBtn.disabled = !dirty;
  if (dirty) {
    status.textContent = 'Đang chờ tự lưu thay đổi...';
  } else if (saved.savedAt) {
    status.textContent = `Đã lưu lúc ${formatSavedAt(saved.savedAt)}. Prompt này sẽ được giữ nguyên sau khi reload hoặc cập nhật code.`;
  } else {
    status.textContent = 'Đang dùng prompt mặc định.';
  }
}

function apply(settings) {
  fields.sharedPrompt.value = settings.sharedPrompt;
  fields.personaA.value = settings.personaA;
  fields.personaB.value = settings.personaB;
  refreshState();
}

function save({ announce = true } = {}) {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = 0;
  const candidate = current(saved?.savedAt || new Date().toISOString());
  if (saved && promptSettingsEqual(candidate, saved)) {
    refreshState();
    return saved;
  }

  const next = current();
  try {
    localStorage.setItem(PROMPT_SETTINGS_STORAGE_KEY, JSON.stringify(next));
    saved = next;
    refreshState();
    if (announce) status.textContent = `Đã lưu lúc ${formatSavedAt(next.savedAt)}. Prompt này sẽ được giữ nguyên sau khi reload hoặc cập nhật code.`;
  } catch {
    status.textContent = 'Không thể lưu vào bộ nhớ trình duyệt. Nội dung hiện tại vẫn được dùng khi bắt đầu phiên.';
  }
  return next;
}

function scheduleAutoSave() {
  refreshState();
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => save({ announce: false }), 350);
}

function restoreDefaults() {
  clearTimeout(autoSaveTimer);
  const next = createPromptSettings(defaults);
  try { localStorage.setItem(PROMPT_SETTINGS_STORAGE_KEY, JSON.stringify(next)); } catch {}
  saved = next;
  apply(saved);
  status.textContent = 'Đã khôi phục và lưu prompt mặc định hiện tại của app.';
}

async function waitForMainApp() {
  for (let i = 0; i < 100; i += 1) {
    if ($('agentAModel')?.textContent && $('agentAModel').textContent !== '-') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function init() {
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    const config = await response.json();
    defaults = createPromptSettings({ sharedPrompt: config?.defaults?.sharedPrompt || '', personaA: '', personaB: '' }, null);
  } catch {}

  await waitForMainApp();
  const stored = parseStoredPromptSettings(localStorage.getItem(PROMPT_SETTINGS_STORAGE_KEY));
  saved = stored || createPromptSettings(defaults);
  apply(saved);

  // Persist the resolved baseline immediately. Future app versions may ship a new
  // default prompt, but this browser keeps the current prompt until Reset is used.
  if (!stored) {
    try { localStorage.setItem(PROMPT_SETTINGS_STORAGE_KEY, JSON.stringify(saved)); } catch {}
  }

  for (const field of Object.values(fields)) field.addEventListener('input', scheduleAutoSave);
  saveBtn.addEventListener('click', () => save());
  resetBtn.addEventListener('click', restoreDefaults);

  // Capture runs before app.js' normal click listener. The exact text visible in the
  // fields is therefore persisted immediately before app.js builds /api/start payload.
  startBtn.addEventListener('click', () => save({ announce: false }), true);
  window.addEventListener('pagehide', () => save({ announce: false }));

  if (resumeAutoStart) {
    const autoStart = $('autoStart');
    const topicMode = $('topicMode');
    autoStart.checked = true;
    localStorage.setItem(autoStartKey, '1');
    topicMode.value = 'auto';
    topicMode.dispatchEvent(new Event('change'));
    if (!startBtn.disabled) startBtn.click();
  }
}

init();
