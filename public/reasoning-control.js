const STORAGE_KEY = 'ai-chat-reasoning-mode-v1';
const LEVELS = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
  { value: 'max', label: 'Max' },
];

function injectStylesheet() {
  if (document.querySelector('link[data-reasoning-control]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/reasoning-control.css';
  link.dataset.reasoningControl = '1';
  document.head.append(link);
}

function normalizeMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return LEVELS.some((item) => item.value === mode) ? mode : 'auto';
}

function levelIndex(mode) {
  const index = LEVELS.findIndex((item) => item.value === mode);
  return index >= 0 ? index : 0;
}

function labelFor(mode) {
  return LEVELS[levelIndex(mode)].label;
}

function savedMode() {
  try { return normalizeMode(localStorage.getItem(STORAGE_KEY)); }
  catch { return 'auto'; }
}

function saveMode(mode) {
  try { localStorage.setItem(STORAGE_KEY, normalizeMode(mode)); } catch {}
}

function capabilityText(mode, reasoning) {
  if (mode === 'auto') return { text: 'Tự điều chỉnh theo độ nặng của lượt', tone: 'neutral' };
  const status = reasoning?.levels?.[mode]?.status || 'unknown';
  if (status === 'verified') return { text: 'Đã xác minh với OpenAI', tone: 'good' };
  if (status === 'accepted') return { text: 'Provider chấp nhận · chưa thể xác minh thực thi nội bộ', tone: 'good' };
  if (status === 'unsupported') return { text: 'Provider không hỗ trợ mức này', tone: 'bad' };
  return { text: 'Chưa xác minh · sẽ kiểm tra khi chọn', tone: 'neutral' };
}

function mount() {
  const form = document.getElementById('userForm');
  const sendBtn = document.getElementById('sendBtn');
  if (!form || !sendBtn || document.getElementById('reasoningControl')) return;

  injectStylesheet();

  const root = document.createElement('div');
  root.id = 'reasoningControl';
  root.className = 'reasoning-control';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'reasoning-trigger';
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.title = 'Mức suy luận cho toàn bộ AI';

  const popover = document.createElement('div');
  popover.className = 'reasoning-popover hidden';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Mức suy luận cho toàn bộ AI');

  const label = document.createElement('div');
  label.className = 'reasoning-current-label';

  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = String(LEVELS.length - 1);
  range.step = '1';
  range.className = 'reasoning-range';
  range.setAttribute('aria-label', 'Mức suy luận');

  const ticks = document.createElement('div');
  ticks.className = 'reasoning-ticks';
  for (const item of LEVELS) {
    const tick = document.createElement('span');
    tick.title = item.label;
    ticks.append(tick);
  }

  const status = document.createElement('div');
  status.className = 'reasoning-capability';

  popover.append(label, range, ticks, status);
  root.append(trigger, popover);
  form.insertBefore(root, sendBtn);

  let committedMode = savedMode();
  let reasoningState = null;
  let applying = false;

  const render = (previewMode = committedMode) => {
    const mode = normalizeMode(previewMode);
    const text = labelFor(mode);
    label.textContent = text;
    trigger.textContent = text;
    range.value = String(levelIndex(mode));
    const capability = capabilityText(mode, reasoningState);
    status.textContent = capability.text;
    status.dataset.tone = capability.tone;
    trigger.dataset.mode = mode;
  };

  const applyMode = async (mode, { initial = false } = {}) => {
    const nextMode = normalizeMode(mode);
    const previous = committedMode;
    applying = true;
    range.disabled = true;
    root.classList.add('is-applying');
    status.textContent = nextMode === 'auto' ? 'Đang áp dụng…' : 'Đang kiểm tra provider…';
    status.dataset.tone = 'neutral';

    try {
      const response = await fetch('/api/reasoning-mode', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: nextMode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      committedMode = normalizeMode(data?.reasoning?.mode || nextMode);
      reasoningState = data?.reasoning || reasoningState;
      saveMode(committedMode);
      render();
    } catch (error) {
      committedMode = previous;
      saveMode(previous);
      render(previous);
      status.textContent = error?.message || 'Không áp dụng được mức suy luận này.';
      status.dataset.tone = 'bad';
      if (initial && previous !== 'auto') {
        committedMode = 'auto';
        saveMode('auto');
        render('auto');
      }
    } finally {
      applying = false;
      range.disabled = false;
      root.classList.remove('is-applying');
    }
  };

  trigger.addEventListener('click', () => {
    const opening = popover.classList.contains('hidden');
    popover.classList.toggle('hidden', !opening);
    trigger.setAttribute('aria-expanded', opening ? 'true' : 'false');
    if (opening) {
      render();
      requestAnimationFrame(() => range.focus({ preventScroll: true }));
    }
  });

  range.addEventListener('input', () => {
    const preview = LEVELS[Number(range.value)]?.value || 'auto';
    render(preview);
  });

  range.addEventListener('change', () => {
    if (applying) return;
    const next = LEVELS[Number(range.value)]?.value || 'auto';
    void applyMode(next);
  });

  document.addEventListener('pointerdown', (event) => {
    if (!root.contains(event.target)) {
      popover.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    popover.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
  });

  render();

  // Imports execute before room-session installs its room-aware fetch wrapper.
  // Delay initial synchronization one task so the request receives the current room id.
  setTimeout(() => {
    void applyMode(committedMode, { initial: true });
  }, 0);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
