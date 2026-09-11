import { HISTORY_LIMIT, HISTORY_STORAGE_KEY, parseStoredHistory, removeHistoryRecord, upsertHistory } from './history.js';
import { getComposerMode } from './composer-mode.js';

const $ = (id) => document.getElementById(id);
const els = {
  workspace: $('workspace'), chat: $('chat'), connectionDot: $('connectionDot'), connectionText: $('connectionText'), roomStatus: $('roomStatus'),
  agentAName: $('agentAName'), agentBName: $('agentBName'), agentAModel: $('agentAModel'), agentBModel: $('agentBModel'),
  agentATotal: $('agentATotal'), agentBTotal: $('agentBTotal'), agentAInput: $('agentAInput'), agentBInput: $('agentBInput'), agentAOutput: $('agentAOutput'), agentBOutput: $('agentBOutput'),
  agentAEstimate: $('agentAEstimate'), agentBEstimate: $('agentBEstimate'), combinedTotal: $('combinedTotal'), turnCounter: $('turnCounter'), topicPreview: $('topicPreview'),
  liveHint: $('liveHint'), pauseBtn: $('pauseBtn'), stopBtn: $('stopBtn'), resetBtn: $('resetBtn'), startBtn: $('startBtn'),
  topicMode: $('topicMode'), topicField: $('topicField'), topic: $('topic'), maxTurns: $('maxTurns'), startSpeaker: $('startSpeaker'), temperature: $('temperature'), maxOutputTokens: $('maxOutputTokens'), autoStart: $('autoStart'),
  sharedPrompt: $('sharedPrompt'), personaA: $('personaA'), personaB: $('personaB'), configWarning: $('configWarning'),
  userForm: $('userForm'), userInput: $('userInput'), sendBtn: $('sendBtn'), toast: $('toast'),
  historyBtn: $('historyBtn'), historyCount: $('historyCount'), historyDrawer: $('historyDrawer'), historyBackdrop: $('historyBackdrop'), closeHistoryBtn: $('closeHistoryBtn'), historyList: $('historyList'), clearHistoryBtn: $('clearHistoryBtn'),
  historyViewBanner: $('historyViewBanner'), historyViewTopic: $('historyViewTopic'), returnLiveBtn: $('returnLiveBtn'),
  collapseControlBtn: $('collapseControlBtn'), expandControlBtn: $('expandControlBtn'),
};

const CONTROL_COLLAPSED_KEY = 'ai-chat-control-collapsed-v1';
let config;
let state;
let eventSource;
let toastTimer;
let viewingHistoryId = null;
let composerSubmitting = false;
let savedSessions = parseStoredHistory(localStorage.getItem(HISTORY_STORAGE_KEY));
let followTail = true;
const streamNodes = new Map();

function formatNumber(value) { return new Intl.NumberFormat('vi-VN').format(Number(value || 0)); }
function formatDate(value) {
  try { return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)); }
  catch { return ''; }
}
function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2800);
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function initials(name) { return String(name || '?').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase(); }

function messageNode(message, streaming = false) {
  const wrapper = document.createElement('article');
  wrapper.className = `message ${message.speaker}`;
  wrapper.dataset.messageId = message.id;
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  avatar.textContent = message.speaker === 'user' ? 'YOU' : initials(message.name);
  const body = document.createElement('div');
  body.className = 'message-body';
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const name = document.createElement('b');
  name.textContent = message.name;
  const usage = document.createElement('span');
  usage.className = 'usage';
  if (message.usage) usage.textContent = `${formatNumber(message.usage.totalTokens)} token${message.usage.exact === false ? ' ~' : ''}`;
  meta.append(name, usage);
  const bubble = document.createElement('div');
  bubble.className = `bubble${streaming ? ' typing' : ''}`;
  const initialText = message.text || '';
  const textNode = document.createTextNode(initialText);
  bubble.append(textNode);
  body.append(meta, bubble);
  wrapper.append(avatar, body);
  return { wrapper, bubble, usage, textNode, rendered: initialText, scrollFrame: 0, finalPayload: null };
}

function cancelStreamFrame(node) {
  if (node?.scrollFrame) cancelAnimationFrame(node.scrollFrame);
  if (node) node.scrollFrame = 0;
}

function clearChat() {
  for (const node of streamNodes.values()) cancelStreamFrame(node);
  els.chat.innerHTML = '';
  streamNodes.clear();
}

function renderTranscript(messages = []) {
  clearChat();
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<div class="empty-orbit">A ↔ B</div><h3>Chưa có drama trí tuệ nhân tạo.</h3><p>Chọn chủ đề hoặc để AI tự chọn, rồi bắt đầu. Bạn có thể ngồi xem hoặc chen ngang bất cứ lúc nào.</p>';
    els.chat.append(empty);
    followTail = true;
    return;
  }
  for (const message of messages) els.chat.append(messageNode(message).wrapper);
  followTail = true;
  requestAnimationFrame(() => scrollChat(true));
}

function removeEmpty() { els.chat.querySelector('.empty-state')?.remove(); }
function distanceFromBottom() { return els.chat.scrollHeight - els.chat.scrollTop - els.chat.clientHeight; }
function scrollChat(force = false) {
  if (force || followTail) els.chat.scrollTop = els.chat.scrollHeight;
}

function scheduleStreamScroll(node) {
  if (!node || !followTail || node.scrollFrame) return;
  node.scrollFrame = requestAnimationFrame(() => {
    node.scrollFrame = 0;
    if (followTail) scrollChat(true);
  });
}

function finalizeStream(messageId) {
  const node = streamNodes.get(messageId);
  if (!node || !node.finalPayload) return;
  const data = node.finalPayload;
  const finalText = data.text || node.rendered;
  if (finalText !== node.rendered) {
    node.rendered = finalText;
    node.textNode.nodeValue = finalText;
  }
  node.bubble.classList.remove('typing');
  if (data.usage) node.usage.textContent = `${formatNumber(data.usage.totalTokens)} token${data.usage.exact === false ? ' ~' : ''}`;
  cancelStreamFrame(node);
  streamNodes.delete(messageId);
  if (followTail) requestAnimationFrame(() => scrollChat(true));
}

function queueStreamDelta(messageId, delta) {
  const node = streamNodes.get(messageId);
  if (!node || !delta) return;
  node.rendered += delta;
  node.textNode.appendData(delta);
  scheduleStreamScroll(node);
}

function completeStream(messageId, payload) {
  const node = streamNodes.get(messageId);
  if (!node) return false;
  node.finalPayload = payload;
  if (payload.text && payload.text !== node.rendered) {
    if (payload.text.startsWith(node.rendered)) {
      const tail = payload.text.slice(node.rendered.length);
      node.rendered += tail;
      node.textNode.appendData(tail);
    } else {
      node.rendered = payload.text;
      node.textNode.nodeValue = payload.text;
    }
  }
  finalizeStream(messageId);
  return true;
}

function renderStats(stats = {}, turn = state?.turn || 0, maxTurns = state?.maxTurns || 20) {
  const a = stats.a || {};
  const b = stats.b || {};
  els.agentATotal.textContent = formatNumber(a.totalTokens);
  els.agentBTotal.textContent = formatNumber(b.totalTokens);
  els.agentAInput.textContent = formatNumber(a.inputTokens);
  els.agentBInput.textContent = formatNumber(b.inputTokens);
  els.agentAOutput.textContent = formatNumber(a.outputTokens);
  els.agentBOutput.textContent = formatNumber(b.outputTokens);
  els.combinedTotal.textContent = formatNumber((a.totalTokens || 0) + (b.totalTokens || 0));
  els.turnCounter.textContent = `${turn || 0} / ${maxTurns || 20}`;
  els.agentAEstimate.textContent = a.estimatedTurns ? '~' : '';
  els.agentBEstimate.textContent = b.estimatedTurns ? '~' : '';
}

function persistSavedSessions() {
  let candidate = savedSessions.slice(0, HISTORY_LIMIT);
  while (candidate.length > 0) {
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(candidate));
      savedSessions = candidate;
      return true;
    } catch {
      candidate = candidate.slice(0, -1);
    }
  }
  try { localStorage.removeItem(HISTORY_STORAGE_KEY); } catch {}
  savedSessions = [];
  toast('Không thể lưu lịch sử. Bộ nhớ trình duyệt đã đầy.');
  return false;
}

function saveCurrentSnapshot(snapshot) {
  const next = upsertHistory(savedSessions, snapshot, new Date().toISOString(), HISTORY_LIMIT);
  if (next === savedSessions || JSON.stringify(next) === JSON.stringify(savedSessions)) return;
  savedSessions = next;
  persistSavedSessions();
  renderHistoryList();
}

function historyStatusLabel(status) {
  return ({ completed: 'Hoàn thành', stopped: 'Đã dừng', error: 'Lỗi', running: 'Đang chạy', paused: 'Tạm dừng', pausing: 'Đang dừng', starting: 'Khởi động' }[status] || status || 'Không rõ');
}

function renderHistoryList() {
  els.historyCount.textContent = savedSessions.length;
  els.historyList.innerHTML = '';
  if (!savedSessions.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.innerHTML = '<strong>Chưa có phiên nào được lưu.</strong><span>Lịch sử sẽ xuất hiện sau khi phòng có ít nhất một tin nhắn.</span>';
    els.historyList.append(empty);
    els.clearHistoryBtn.disabled = true;
    return;
  }
  els.clearHistoryBtn.disabled = false;
  for (const session of savedSessions) {
    const item = document.createElement('article');
    item.className = `history-item${viewingHistoryId === session.runId ? ' active' : ''}`;
    item.tabIndex = 0;
    const top = document.createElement('div');
    top.className = 'history-item-top';
    const title = document.createElement('strong');
    title.textContent = session.topic;
    const deleteButton = document.createElement('button');
    deleteButton.className = 'history-delete';
    deleteButton.type = 'button';
    deleteButton.title = 'Xóa phiên này';
    deleteButton.textContent = '×';
    deleteButton.addEventListener('click', (event) => {
      event.stopPropagation();
      savedSessions = removeHistoryRecord(savedSessions, session.runId);
      persistSavedSessions();
      if (viewingHistoryId === session.runId) returnToLive();
      renderHistoryList();
    });
    top.append(title, deleteButton);
    const meta = document.createElement('div');
    meta.className = 'history-meta';
    const total = (session.stats?.a?.totalTokens || 0) + (session.stats?.b?.totalTokens || 0);
    meta.textContent = `${formatDate(session.savedAt)} · ${historyStatusLabel(session.status)} · ${session.history.length} tin · ${formatNumber(total)} token`;
    item.append(top, meta);
    const open = () => openHistorySession(session.runId);
    item.addEventListener('click', open);
    item.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
    els.historyList.append(item);
  }
}

function openHistoryDrawer() {
  els.historyDrawer.classList.add('open');
  els.historyDrawer.setAttribute('aria-hidden', 'false');
  els.historyBackdrop.classList.remove('hidden');
}
function closeHistoryDrawer() {
  els.historyDrawer.classList.remove('open');
  els.historyDrawer.setAttribute('aria-hidden', 'true');
  els.historyBackdrop.classList.add('hidden');
}
function openHistorySession(runId) {
  const session = savedSessions.find((item) => item.runId === runId);
  if (!session) return;
  viewingHistoryId = runId;
  renderTranscript(session.history);
  renderStats(session.stats, session.turn, session.maxTurns);
  els.topicPreview.textContent = session.topic;
  els.historyViewTopic.textContent = session.topic;
  els.historyViewBanner.classList.remove('hidden');
  updateComposerState();
  renderHistoryList();
  closeHistoryDrawer();
}
function returnToLive() {
  viewingHistoryId = null;
  els.historyViewBanner.classList.add('hidden');
  if (state) {
    renderTranscript(state.history || []);
    renderStats(state.stats, state.turn, state.maxTurns);
    els.topicPreview.textContent = state.topic || 'Chưa có chủ đề.';
  }
  updateComposerState();
  renderHistoryList();
}

function agentsConfigured() {
  return Boolean(config) && Object.values(config.agents || {}).every((agent) => agent.configured);
}

function currentComposerMode() {
  return getComposerMode({
    status: state?.status || 'idle',
    configured: agentsConfigured(),
    viewingHistory: Boolean(viewingHistoryId),
    submitting: composerSubmitting,
  });
}

function updateComposerState() {
  const mode = currentComposerMode();
  els.userInput.disabled = !mode.enabled;
  els.sendBtn.disabled = !mode.enabled;
  els.userInput.placeholder = mode.placeholder;
  els.userForm.dataset.mode = mode.action;
}

function applyState(next, { history = false } = {}) {
  state = next;
  saveCurrentSnapshot(next);
  els.roomStatus.textContent = next.status;
  const active = ['starting', 'running', 'paused', 'pausing'].includes(next.status);
  const running = next.status === 'running' || next.status === 'pausing';
  const paused = next.status === 'paused';
  els.startBtn.disabled = active;
  els.stopBtn.disabled = !active;
  els.pauseBtn.disabled = !running && !paused;
  els.pauseBtn.textContent = paused ? 'Tiếp tục' : (next.status === 'pausing' ? 'Đang tạm dừng…' : 'Tạm dừng');
  const completedHint = next.endedBy && ['a', 'b'].includes(next.endedBy)
    ? `${config?.agents?.[next.endedBy]?.name || 'AI'} đã kết thúc phiên.`
    : 'Phiên đã hoàn thành.';
  els.liveHint.textContent = next.currentSpeaker
    ? `${config?.agents?.[next.currentSpeaker]?.name || next.currentSpeaker} đang trả lời...`
    : ({ idle: 'Chưa bắt đầu phiên.', starting: 'Đang chuẩn bị phiên...', paused: 'Đã tạm dừng.', pausing: 'Sẽ tạm dừng sau lượt hiện tại.', stopped: 'Phiên đã dừng.', completed: completedHint, error: 'Phiên gặp lỗi.' }[next.status] || 'Sẵn sàng.');
  updateComposerState();
  if (!viewingHistoryId) {
    els.topicPreview.textContent = next.topic || 'Chưa có chủ đề.';
    renderStats(next.stats, next.turn, next.maxTurns);
    if (history) renderTranscript(next.history);
  }
}

function setTopicMode() {
  const auto = els.topicMode.value === 'auto';
  els.topicField.classList.toggle('hidden', auto);
  if (!auto) els.autoStart.checked = false;
  els.autoStart.disabled = !auto;
  localStorage.setItem('ai-chat-auto-start', auto && els.autoStart.checked ? '1' : '0');
}

function setControlCollapsed(collapsed, { persist = true } = {}) {
  els.workspace.classList.toggle('controls-collapsed', collapsed);
  els.expandControlBtn.classList.toggle('hidden', !collapsed);
  els.collapseControlBtn.setAttribute('aria-expanded', String(!collapsed));
  els.expandControlBtn.setAttribute('aria-expanded', String(!collapsed));
  if (persist) localStorage.setItem(CONTROL_COLLAPSED_KEY, collapsed ? '1' : '0');
  requestAnimationFrame(() => { if (followTail) scrollChat(true); });
}

async function load() {
  [config, state] = await Promise.all([api('/api/config'), api('/api/state')]);
  els.agentAName.textContent = config.agents.a.name;
  els.agentBName.textContent = config.agents.b.name;
  els.agentAModel.textContent = config.agents.a.model || 'chưa cấu hình';
  els.agentBModel.textContent = config.agents.b.model || 'chưa cấu hình';
  els.sharedPrompt.value = config.defaults.sharedPrompt;
  els.maxTurns.value = config.defaults.maxTurns;
  els.temperature.value = config.defaults.temperature;
  els.maxOutputTokens.value = config.defaults.maxOutputTokens;
  els.autoStart.checked = localStorage.getItem('ai-chat-auto-start') === '1';
  const missing = Object.values(config.agents).filter((agent) => !agent.configured);
  if (missing.length) {
    els.configWarning.classList.remove('hidden');
    els.configWarning.textContent = `${missing.map((agent) => agent.name).join(' và ')} chưa có đủ API key/model/base URL trong .env.`;
  }
  renderHistoryList();
  applyState(state, { history: true });
  connectEvents();
  if (els.autoStart.checked && state.status === 'idle') {
    els.topicMode.value = 'auto';
    setTopicMode();
    if (!missing.length) await startConversation();
  }
}

function connectEvents() {
  eventSource?.close();
  eventSource = new EventSource('/api/events');
  eventSource.onopen = () => { els.connectionDot.classList.add('online'); els.connectionDot.classList.remove('offline'); els.connectionText.textContent = 'Realtime'; };
  eventSource.onerror = () => { els.connectionDot.classList.remove('online'); els.connectionText.textContent = 'Đang nối lại'; };
  eventSource.addEventListener('state', (event) => applyState(JSON.parse(event.data)));
  eventSource.addEventListener('topic', (event) => {
    const data = JSON.parse(event.data);
    if (!viewingHistoryId) els.topicPreview.textContent = data.topic;
    toast(`Chủ đề: ${data.topic}`);
  });
  eventSource.addEventListener('meta', (event) => toast(JSON.parse(event.data).text));
  eventSource.addEventListener('stats', (event) => { if (!viewingHistoryId) renderStats(JSON.parse(event.data), state?.turn, state?.maxTurns); });
  eventSource.addEventListener('room:error', (event) => toast(JSON.parse(event.data).message));
  eventSource.addEventListener('message:start', (event) => {
    if (viewingHistoryId) return;
    const data = JSON.parse(event.data);
    removeEmpty();
    const node = messageNode({ ...data, text: '' }, true);
    streamNodes.set(data.id, node);
    els.chat.append(node.wrapper);
    if (followTail) requestAnimationFrame(() => scrollChat(true));
  });
  eventSource.addEventListener('message:delta', (event) => {
    if (viewingHistoryId) return;
    const data = JSON.parse(event.data);
    queueStreamDelta(data.id, data.delta);
  });
  eventSource.addEventListener('message:cancelled', (event) => {
    const data = JSON.parse(event.data);
    const existing = streamNodes.get(data.id);
    cancelStreamFrame(existing);
    if (existing) existing.wrapper.remove();
    streamNodes.delete(data.id);
  });
  eventSource.addEventListener('message:failed', (event) => {
    const data = JSON.parse(event.data);
    const existing = streamNodes.get(data.id);
    if (existing) {
      cancelStreamFrame(existing);
      const partial = existing.rendered;
      existing.bubble.classList.remove('typing');
      existing.bubble.classList.add('failed');
      existing.bubble.textContent = partial ? `${partial}\n\n[Lượt trả lời bị gián đoạn]` : '[Lượt trả lời bị lỗi]';
      streamNodes.delete(data.id);
    }
    toast(data.message || 'AI trả lời thất bại.');
  });
  eventSource.addEventListener('message:done', (event) => {
    if (viewingHistoryId) return;
    const data = JSON.parse(event.data);
    removeEmpty();
    if (!completeStream(data.id, data) && !els.chat.querySelector(`[data-message-id="${CSS.escape(data.id)}"]`)) {
      els.chat.append(messageNode(data).wrapper);
      if (followTail) requestAnimationFrame(() => scrollChat(true));
    }
  });
}

function buildStartPayload(topicMode, topic) {
  return {
    topicMode,
    topic,
    maxTurns: Number(els.maxTurns.value),
    startSpeaker: els.startSpeaker.value,
    temperature: Number(els.temperature.value),
    maxOutputTokens: Number(els.maxOutputTokens.value),
    sharedPrompt: els.sharedPrompt.value,
    personaA: els.personaA.value,
    personaB: els.personaB.value,
  };
}

async function startConversation() {
  try {
    const topicMode = els.topicMode.value;
    const topic = els.topic.value.trim();
    if (topicMode === 'manual' && !topic) { toast('Hãy nhập chủ đề trước khi bắt đầu phiên.'); els.topic.focus(); return; }
    if (viewingHistoryId) returnToLive();
    await api('/api/start', { method: 'POST', body: JSON.stringify(buildStartPayload(topicMode, topic)) });
    if (topicMode === 'manual') els.topic.value = '';
  } catch (error) { toast(error.message); }
}

els.topicMode.addEventListener('change', setTopicMode);
els.autoStart.addEventListener('change', () => localStorage.setItem('ai-chat-auto-start', els.autoStart.checked ? '1' : '0'));
els.startBtn.addEventListener('click', startConversation);
els.pauseBtn.addEventListener('click', async () => { try { await api(state?.status === 'paused' ? '/api/resume' : '/api/pause', { method: 'POST', body: '{}' }); } catch (error) { toast(error.message); } });
els.stopBtn.addEventListener('click', async () => { try { await api('/api/stop', { method: 'POST', body: '{}' }); } catch (error) { toast(error.message); } });
els.resetBtn.addEventListener('click', async () => { try { if (viewingHistoryId) returnToLive(); const next = await api('/api/reset', { method: 'POST', body: '{}' }); applyState(next, { history: true }); } catch (error) { toast(error.message); } });
els.userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = els.userInput.value.trim();
  const mode = currentComposerMode();
  if (!text || !mode.enabled || viewingHistoryId) return;

  els.userInput.value = '';
  composerSubmitting = true;
  updateComposerState();
  try {
    if (mode.action === 'message') {
      await api('/api/message', { method: 'POST', body: JSON.stringify({ text }) });
    } else if (mode.action === 'start') {
      const next = await api('/api/start', { method: 'POST', body: JSON.stringify(buildStartPayload('manual', text)) });
      applyState(next, { history: true });
    }
  } catch (error) {
    els.userInput.value = text;
    toast(error.message);
  } finally {
    composerSubmitting = false;
    updateComposerState();
  }
});
els.historyBtn.addEventListener('click', openHistoryDrawer);
els.closeHistoryBtn.addEventListener('click', closeHistoryDrawer);
els.historyBackdrop.addEventListener('click', closeHistoryDrawer);
els.returnLiveBtn.addEventListener('click', returnToLive);
els.clearHistoryBtn.addEventListener('click', () => {
  if (!savedSessions.length) return;
  if (!window.confirm('Xóa toàn bộ lịch sử trò chuyện trên trình duyệt này?')) return;
  savedSessions = [];
  localStorage.removeItem(HISTORY_STORAGE_KEY);
  if (viewingHistoryId) returnToLive();
  renderHistoryList();
  toast('Đã xóa lịch sử trò chuyện.');
});
els.collapseControlBtn.addEventListener('click', () => setControlCollapsed(true));
els.expandControlBtn.addEventListener('click', () => setControlCollapsed(false));
els.chat.addEventListener('scroll', () => { followTail = distanceFromBottom() < 120; }, { passive: true });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeHistoryDrawer(); });

setTopicMode();
setControlCollapsed(localStorage.getItem(CONTROL_COLLAPSED_KEY) === '1', { persist: false });
renderHistoryList();
load().catch((error) => toast(error.message));