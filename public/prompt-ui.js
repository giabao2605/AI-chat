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
let saved = parseStoredPromptSettings(localStorage.getItem(PROMPT_SETTINGS_STORAGE_KEY));
let autoSaveTimer = 0;
let initialized = false;
let userEdited = false;

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
  if (!settings) return;
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
    userEdited = false;
    refreshState();
    return saved;
  }

  const next = current();
  try {
    localStorage.setItem(PROMPT_SETTINGS_STORAGE_KEY, JSON.stringify(next));
    saved = next;
    userEdited = false;
    refreshState();
    if (announce) status.textContent = `Đã lưu lúc ${formatSavedAt(next.savedAt)}. Prompt này sẽ được giữ nguyên sau khi reload hoặc cập nhật code.`;
  } catch {
    status.textContent = 'Không thể lưu vào bộ nhớ trình duyệt. Nội dung hiện tại vẫn được dùng khi bắt đầu phiên.';
  }
  return next;
}

function scheduleAutoSave() {
  userEdited = true;
  refreshState();
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => save({ announce: false }), 350);
}

function restoreDefaults() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = 0;
  const next = createPromptSettings(defaults);
  try { localStorage.setItem(PROMPT_SETTINGS_STORAGE_KEY, JSON.stringify(next)); } catch {}
  saved = next;
  userEdited = false;
  apply(saved);
  status.textContent = 'Đã khôi phục và lưu prompt mặc định hiện tại của app.';
}

function mainAppReady() {
  const model = $('agentAModel');
  return Boolean(model?.textContent && model.textContent !== '-');
}

async function waitForMainApp() {
  if (mainAppReady()) return;
  const model = $('agentAModel');
  if (!model || typeof MutationObserver === 'undefined') return;

  await new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (!mainAppReady()) return;
      observer.disconnect();
      resolve();
    });
    observer.observe(model, { childList: true, characterData: true, subtree: true });
  });
}

function nextPaint() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

async function init() {
  // Restore the browser-owned value immediately. app.js may still paint its server
  // default during startup, so we deliberately restore once more after app init below.
  if (saved) apply(saved);

  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    const config = await response.json();
    defaults = createPromptSettings({ sharedPrompt: config?.defaults?.sharedPrompt || '', personaA: '', personaB: '' }, null);
  } catch {}

  await waitForMainApp();
  await nextPaint();
  await nextPaint();

  // Re-read storage in case another same-origin tab saved while this page was loading.
  const stored = parseStoredPromptSettings(localStorage.getItem(PROMPT_SETTINGS_STORAGE_KEY));
  saved = stored || saved || createPromptSettings(defaults);
  apply(saved);

  if (!stored) {
    try { localStorage.setItem(PROMPT_SETTINGS_STORAGE_KEY, JSON.stringify(saved)); } catch {}
  }

  for (const field of Object.values(fields)) field.addEventListener('input', scheduleAutoSave);
  saveBtn.addEventListener('click', () => save());
  resetBtn.addEventListener('click', restoreDefaults);

  // Capture the exact visible prompt before starting a session. If startup is still
  // settling, re-apply the saved value first instead of persisting a server default.
  startBtn.addEventListener('click', () => {
    if (!initialized && saved) apply(saved);
    save({ announce: false });
  }, true);

  // Only persist on pagehide when the user actually edited a field. Programmatic
  // writes from app startup must never overwrite the saved browser-owned prompt.
  window.addEventListener('pagehide', () => {
    if (userEdited) save({ announce: false });
  });

  initialized = true;

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
