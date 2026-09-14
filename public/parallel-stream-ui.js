const $ = (id) => document.getElementById(id);

const ACTIVE_ACTIVITY = new Set(['queued', 'thinking', 'researching', 'streaming', 'tooling', 'failed']);
const STATUS_LABELS = {
  queued: 'Sắp trả lời…',
  thinking: 'Đang suy nghĩ…',
  researching: 'Đang tìm kiếm web…',
  streaming: 'Đang trả lời…',
  tooling: 'Đang dùng công cụ…',
  failed: 'Gặp lỗi',
};

let config = null;
let state = null;
let source = null;
let panel = null;
let chatObserver = null;
let historyObserver = null;
const activityStates = {};
const clearTimers = new Map();

function ensureStyles() {
  if (document.querySelector('link[href="/parallel-stream-ui.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/parallel-stream-ui.css';
  document.head.append(link);
}

function ensureUi() {
  ensureStyles();
  const chat = $('chat');
  if (!chat) return;

  if (!panel) {
    panel = document.createElement('section');
    panel.id = 'agentActivityPanel';
    panel.className = 'agent-activity-panel hidden';
    panel.setAttribute('aria-live', 'polite');
    panel.setAttribute('aria-label', 'Trạng thái hoạt động của AI');
  }

  if (panel.parentElement !== chat) chat.append(panel);
  else if (chat.lastElementChild !== panel) chat.append(panel);

  if (!chatObserver) {
    chatObserver = new MutationObserver(() => {
      if (!panel || !chat.isConnected) return;
      if (panel.parentElement !== chat || chat.lastElementChild !== panel) chat.append(panel);
    });
    chatObserver.observe(chat, { childList: true });
  }

  if (!historyObserver) {
    const banner = $('historyViewBanner');
    if (banner) {
      historyObserver = new MutationObserver(render);
      historyObserver.observe(banner, { attributes: true, attributeFilter: ['class'] });
    }
  }
}

function isViewingHistory() {
  const banner = $('historyViewBanner');
  return Boolean(banner && !banner.classList.contains('hidden'));
}

function agentName(id) {
  return config?.agents?.[id]?.name || `Agent ${String(id || '').toUpperCase()}`;
}

function agentInitials(id) {
  return agentName(id)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function activeAgentIds() {
  if (Array.isArray(state?.activeAgents) && state.activeAgents.length) return state.activeAgents;
  return Object.entries(config?.agents || {})
    .filter(([, value]) => value?.configured)
    .map(([id]) => id);
}

function clearTimer(agentId) {
  const timer = clearTimers.get(agentId);
  if (timer) clearTimeout(timer);
  clearTimers.delete(agentId);
}

function setActivity(agentId, status, extra = {}) {
  if (!agentId || agentId === 'user' || agentId === 'tool') return;
  clearTimer(agentId);
  activityStates[agentId] = {
    ...(activityStates[agentId] || {}),
    status,
    detail: extra.detail ?? '',
    messageId: extra.messageId ?? activityStates[agentId]?.messageId ?? null,
    error: extra.error ?? '',
    updatedAt: Date.now(),
  };
  render();
}

function clearActivity(agentId, delay = 0) {
  if (!agentId) return;
  clearTimer(agentId);
  if (!delay) {
    delete activityStates[agentId];
    render();
    return;
  }
  const timer = setTimeout(() => {
    clearTimers.delete(agentId);
    delete activityStates[agentId];
    render();
  }, delay);
  clearTimers.set(agentId, timer);
}

function clearAllActivities() {
  for (const timer of clearTimers.values()) clearTimeout(timer);
  clearTimers.clear();
  for (const id of Object.keys(activityStates)) delete activityStates[id];
  render();
}

function labelFor(info) {
  return info?.detail || STATUS_LABELS[info?.status] || 'Đang xử lý…';
}

function render() {
  ensureUi();
  if (!panel) return;

  if (isViewingHistory()) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }

  const ids = activeAgentIds().filter((id) => ACTIVE_ACTIVITY.has(activityStates[id]?.status));
  if (!ids.length) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }

  panel.classList.remove('hidden');
  panel.innerHTML = '';

  for (const id of ids) {
    const info = activityStates[id];
    const row = document.createElement('div');
    row.className = `agent-activity-row status-${info.status}`;
    row.dataset.agentId = id;

    const avatar = document.createElement('div');
    avatar.className = 'agent-activity-avatar';
    avatar.textContent = agentInitials(id);

    const copy = document.createElement('div');
    copy.className = 'agent-activity-copy';

    const name = document.createElement('strong');
    name.textContent = agentName(id);

    const status = document.createElement('span');
    status.className = 'agent-activity-text';
    status.textContent = labelFor(info);
    if (info.error) status.title = info.error;

    copy.append(name, status);
    row.append(avatar, copy);
    panel.append(row);
  }

  const chat = $('chat');
  if (chat && chat.lastElementChild !== panel) chat.append(panel);
  requestAnimationFrame(() => {
    const current = $('chat');
    if (!current) return;
    const distance = current.scrollHeight - current.scrollTop - current.clientHeight;
    if (distance < 180) current.scrollTop = current.scrollHeight;
  });
}

function syncFromState(next) {
  state = next;
  if (!next || ['idle', 'stopped', 'completed', 'error'].includes(next.status)) {
    clearAllActivities();
    return;
  }

  if (next.agentStates && typeof next.agentStates === 'object') {
    for (const [id, info] of Object.entries(next.agentStates)) {
      const status = info?.status;
      if (['queued', 'thinking', 'researching', 'streaming'].includes(status)) {
        const previous = activityStates[id];
        const preserveDetail = previous?.status === status ? previous.detail : '';
        setActivity(id, status, {
          detail: preserveDetail,
          messageId: info?.messageId || previous?.messageId || null,
          error: info?.error || '',
        });
      } else if (status === 'failed') {
        setActivity(id, 'failed', { detail: 'Gặp lỗi', error: info?.error || '' });
        clearActivity(id, 1800);
      } else if (status === 'cancelled' || status === 'done' || status === 'idle') {
        clearActivity(id);
      }
    }
  }

  const speakers = Array.isArray(next.currentSpeakers) && next.currentSpeakers.length
    ? next.currentSpeakers
    : (next.currentSpeaker ? [next.currentSpeaker] : []);

  if (next.conversationMode !== 'parallel') {
    const speakerSet = new Set(speakers);
    for (const id of activeAgentIds()) {
      if (speakerSet.has(id)) {
        if (!ACTIVE_ACTIVITY.has(activityStates[id]?.status)) setActivity(id, 'thinking');
      } else if (activityStates[id]?.status !== 'failed') {
        clearActivity(id);
      }
    }
  }

  render();
}

function decorateMessage(data) {
  if (!data?.id) return;
  requestAnimationFrame(() => {
    const node = document.querySelector(`[data-message-id="${CSS.escape(data.id)}"]`);
    if (!node) return;
    node.classList.add('parallel-stream-message');
    if (data.startSequence) node.dataset.startSequence = String(data.startSequence);
    if (data.startedAt) node.dataset.startedAt = data.startedAt;
  });
}

function activityFromMeta(data) {
  const text = String(data?.text || '');
  if (!text) return;
  for (const id of activeAgentIds()) {
    const name = agentName(id);
    if (!text.startsWith(name)) continue;
    if (/đang dùng tool tạo ảnh/i.test(text)) {
      setActivity(id, 'tooling', { detail: 'Đang tạo ảnh…' });
    } else if (/đang tự chọn chủ đề/i.test(text)) {
      setActivity(id, 'thinking', { detail: 'Đang chọn chủ đề…' });
    }
  }
}

async function init() {
  ensureUi();
  try {
    [config, state] = await Promise.all([
      fetch('/api/config', { cache: 'no-store' }).then((res) => res.json()),
      fetch('/api/state', { cache: 'no-store' }).then((res) => res.json()),
    ]);
    syncFromState(state);
  } catch {}

  source?.close();
  source = new EventSource('/api/events');

  source.addEventListener('state', (event) => syncFromState(JSON.parse(event.data)));

  source.addEventListener('parallel:agent-status', (event) => {
    const data = JSON.parse(event.data);
    if (!data.agentId) return;
    if (['queued', 'thinking', 'researching', 'streaming'].includes(data.status)) {
      const previous = activityStates[data.agentId];
      setActivity(data.agentId, data.status, {
        detail: previous?.status === data.status ? previous.detail : '',
        messageId: data.messageId || null,
        error: data.error || '',
      });
    } else if (data.status === 'failed') {
      setActivity(data.agentId, 'failed', { detail: 'Gặp lỗi', error: data.error || '' });
      clearActivity(data.agentId, 1800);
    } else if (['done', 'cancelled', 'idle'].includes(data.status)) {
      clearActivity(data.agentId);
    }
  });

  source.addEventListener('research:start', (event) => {
    const data = JSON.parse(event.data);
    const count = Array.isArray(data.queries) ? data.queries.length : 0;
    setActivity(data.speaker, 'researching', {
      detail: count ? `Đang tìm kiếm web · ${count} truy vấn…` : 'Đang tìm kiếm web…',
    });
  });

  source.addEventListener('research:done', (event) => {
    const data = JSON.parse(event.data);
    const count = Array.isArray(data.sources) ? data.sources.length : 0;
    setActivity(data.speaker, 'thinking', {
      detail: count ? `Đã lấy ${count} nguồn · đang tổng hợp…` : 'Đã tìm web · đang tổng hợp…',
    });
  });

  source.addEventListener('research:error', (event) => {
    const data = JSON.parse(event.data);
    setActivity(data.speaker, 'thinking', {
      detail: 'Tìm kiếm web thất bại · đang tiếp tục…',
      error: data.message || '',
    });
  });

  source.addEventListener('meta', (event) => activityFromMeta(JSON.parse(event.data)));

  source.addEventListener('message:start', (event) => {
    const data = JSON.parse(event.data);
    if (data.speaker !== 'tool' && data.speaker !== 'user') {
      setActivity(data.speaker, 'streaming', { detail: 'Đang trả lời…', messageId: data.id });
    }
    decorateMessage(data);
  });

  source.addEventListener('message:delta', (event) => {
    const data = JSON.parse(event.data);
    if (data.speaker !== 'tool' && data.speaker !== 'user' && activityStates[data.speaker]?.status !== 'streaming') {
      setActivity(data.speaker, 'streaming', { detail: 'Đang trả lời…', messageId: data.id });
    }
  });

  source.addEventListener('message:done', (event) => {
    const data = JSON.parse(event.data);
    decorateMessage(data);
    if (data.speaker !== 'tool' && data.speaker !== 'user') clearActivity(data.speaker, 350);
  });

  source.addEventListener('message:failed', (event) => {
    const data = JSON.parse(event.data);
    setActivity(data.speaker, 'failed', { detail: 'Lượt trả lời gặp lỗi', error: data.message || '' });
    clearActivity(data.speaker, 1800);
  });

  source.addEventListener('message:cancelled', (event) => {
    const data = JSON.parse(event.data);
    clearActivity(data.speaker);
  });
}

window.addEventListener('pagehide', () => {
  source?.close();
  chatObserver?.disconnect();
  historyObserver?.disconnect();
  for (const timer of clearTimers.values()) clearTimeout(timer);
});

init();
