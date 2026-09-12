const $ = (id) => document.getElementById(id);

const STATUS_LABELS = {
  idle: 'Chờ',
  queued: 'Xếp hàng',
  thinking: 'Đang nghĩ',
  researching: 'Đang tìm web',
  streaming: 'Đang trả lời',
  done: 'Xong',
  failed: 'Lỗi',
  cancelled: 'Đã hủy',
};

let config = null;
let state = null;
let batch = null;
let agentStates = {};
let source = null;
let panel = null;
let title = null;
let chips = null;
let followButton = null;

function ensureStyles() {
  if (document.querySelector('link[href="/parallel-stream-ui.css"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/parallel-stream-ui.css';
  document.head.append(link);
}

function ensureUi() {
  if (panel) return;
  ensureStyles();
  const research = $('researchStatus');
  const host = research?.parentElement || document.querySelector('.chat-toolbar > div:first-child');
  if (!host) return;

  panel = document.createElement('div');
  panel.id = 'parallelLivePanel';
  panel.className = 'parallel-live-panel hidden';
  panel.setAttribute('aria-live', 'polite');
  panel.innerHTML = `
    <div class="parallel-live-head">
      <span class="parallel-live-pulse"></span>
      <strong id="parallelLiveTitle">Song song</strong>
      <button id="parallelFollowLive" type="button" class="parallel-follow-live hidden">↓ Live</button>
    </div>
    <div id="parallelAgentChips" class="parallel-agent-chips"></div>
  `;
  host.append(panel);
  title = $('parallelLiveTitle');
  chips = $('parallelAgentChips');
  followButton = $('parallelFollowLive');
  followButton?.addEventListener('click', () => {
    const chat = $('chat');
    if (!chat) return;
    chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
  });
  $('chat')?.addEventListener('scroll', refreshFollowButton, { passive: true });
}

function activeAgentIds() {
  if (Array.isArray(state?.activeAgents) && state.activeAgents.length) return state.activeAgents;
  return Object.entries(config?.agents || {}).filter(([, value]) => value?.configured).map(([id]) => id);
}

function currentAgentState(id) {
  return agentStates[id] || state?.agentStates?.[id] || { status: 'idle' };
}

function streamingCount() {
  return activeAgentIds().filter((id) => ['streaming', 'researching', 'thinking', 'queued'].includes(currentAgentState(id).status)).length;
}

function refreshFollowButton() {
  if (!followButton) return;
  const chat = $('chat');
  const count = streamingCount();
  if (!chat || !count) {
    followButton.classList.add('hidden');
    return;
  }
  const distance = chat.scrollHeight - chat.scrollTop - chat.clientHeight;
  followButton.classList.toggle('hidden', distance < 160);
  followButton.textContent = `↓ Live · ${count}`;
}

function render() {
  ensureUi();
  if (!panel) return;
  const parallel = state?.conversationMode === 'parallel';
  const active = ['starting', 'running', 'pausing', 'paused'].includes(state?.status);
  panel.classList.toggle('hidden', !(parallel && active));
  if (!(parallel && active)) return;

  batch = state?.parallelBatch || batch;
  const number = batch?.number || 0;
  const count = streamingCount();
  if (state?.status === 'paused') title.textContent = number ? `Round ${number} · tạm dừng` : 'Song song · tạm dừng';
  else if (number) title.textContent = `Round ${number}${count ? ` · ${count} AI đang hoạt động` : ''}`;
  else title.textContent = count ? `${count} AI đang hoạt động` : 'Chuẩn bị round mới';

  chips.innerHTML = '';
  for (const id of activeAgentIds()) {
    const agent = config?.agents?.[id] || { name: `Agent ${id.toUpperCase()}` };
    const info = currentAgentState(id);
    const chip = document.createElement('div');
    chip.className = `parallel-agent-chip status-${info.status || 'idle'}`;
    chip.dataset.agentId = id;
    const dot = document.createElement('span');
    dot.className = 'parallel-agent-dot';
    const name = document.createElement('b');
    name.textContent = agent.name || `Agent ${id.toUpperCase()}`;
    const status = document.createElement('span');
    status.textContent = STATUS_LABELS[info.status] || info.status || 'Chờ';
    if (info.error) chip.title = info.error;
    chip.append(dot, name, status);
    chips.append(chip);
  }
  refreshFollowButton();
}

function decorateMessage(data) {
  if (!data?.id) return;
  requestAnimationFrame(() => {
    const node = document.querySelector(`[data-message-id="${CSS.escape(data.id)}"]`);
    if (!node) return;
    node.classList.add('parallel-stream-message');
    if (data.batchId) node.dataset.batchId = data.batchId;
    if (data.startSequence) node.dataset.startSequence = String(data.startSequence);
    const meta = node.querySelector('.message-meta');
    if (!meta || meta.querySelector('.parallel-round-badge')) return;
    const badge = document.createElement('span');
    badge.className = 'parallel-round-badge';
    badge.textContent = data.batchNumber ? `R${data.batchNumber}` : 'LIVE';
    meta.append(badge);
  });
}

async function init() {
  ensureUi();
  try {
    [config, state] = await Promise.all([
      fetch('/api/config', { cache: 'no-store' }).then((res) => res.json()),
      fetch('/api/state', { cache: 'no-store' }).then((res) => res.json()),
    ]);
    agentStates = { ...(state?.agentStates || {}) };
    batch = state?.parallelBatch || null;
    render();
  } catch {}

  source?.close();
  source = new EventSource('/api/events');
  source.addEventListener('state', (event) => {
    const next = JSON.parse(event.data);
    state = next;
    if (next.agentStates) agentStates = { ...agentStates, ...next.agentStates };
    batch = next.parallelBatch || null;
    render();
  });
  source.addEventListener('parallel:batch', (event) => {
    const next = JSON.parse(event.data);
    batch = next.status === 'completed' ? { ...next, status: 'completed' } : next;
    render();
  });
  source.addEventListener('parallel:agent-status', (event) => {
    const next = JSON.parse(event.data);
    if (!next.agentId) return;
    agentStates[next.agentId] = next;
    render();
  });
  source.addEventListener('message:start', (event) => decorateMessage(JSON.parse(event.data)));
  source.addEventListener('message:done', (event) => decorateMessage(JSON.parse(event.data)));
}

window.addEventListener('pagehide', () => source?.close());
init();
