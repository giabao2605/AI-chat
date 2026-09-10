const $ = (id) => document.getElementById(id);
const els = {
  chat: $('chat'), emptyState: $('emptyState'), connectionDot: $('connectionDot'), connectionText: $('connectionText'), roomStatus: $('roomStatus'),
  agentAName: $('agentAName'), agentBName: $('agentBName'), agentAModel: $('agentAModel'), agentBModel: $('agentBModel'),
  agentATotal: $('agentATotal'), agentBTotal: $('agentBTotal'), agentAInput: $('agentAInput'), agentBInput: $('agentBInput'), agentAOutput: $('agentAOutput'), agentBOutput: $('agentBOutput'),
  agentAEstimate: $('agentAEstimate'), agentBEstimate: $('agentBEstimate'), combinedTotal: $('combinedTotal'), turnCounter: $('turnCounter'), topicPreview: $('topicPreview'),
  liveHint: $('liveHint'), pauseBtn: $('pauseBtn'), stopBtn: $('stopBtn'), resetBtn: $('resetBtn'), startBtn: $('startBtn'),
  topicMode: $('topicMode'), topicField: $('topicField'), topic: $('topic'), maxTurns: $('maxTurns'), startSpeaker: $('startSpeaker'), temperature: $('temperature'), maxOutputTokens: $('maxOutputTokens'), autoStart: $('autoStart'),
  sharedPrompt: $('sharedPrompt'), personaA: $('personaA'), personaB: $('personaB'), configWarning: $('configWarning'),
  userForm: $('userForm'), userInput: $('userInput'), sendBtn: $('sendBtn'), toast: $('toast'),
};

let config;
let state;
let eventSource;
let toastTimer;
const streamNodes = new Map();

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function initials(name) {
  return String(name || '?').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

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
  bubble.textContent = message.text || '';
  body.append(meta, bubble);
  wrapper.append(avatar, body);
  return { wrapper, bubble, usage };
}

function clearChat() {
  els.chat.innerHTML = '';
  streamNodes.clear();
}

function renderHistory(history = []) {
  clearChat();
  if (!history.length) {
    const clone = document.createElement('div');
    clone.className = 'empty-state';
    clone.innerHTML = '<div class="empty-orbit">A ↔ B</div><h3>Chưa có drama trí tuệ nhân tạo.</h3><p>Chọn chủ đề hoặc để AI tự chọn, rồi bắt đầu. Bạn có thể ngồi xem hoặc chen ngang bất cứ lúc nào.</p>';
    els.chat.append(clone);
    return;
  }
  for (const message of history) els.chat.append(messageNode(message).wrapper);
  scrollChat();
}

function removeEmpty() {
  const empty = els.chat.querySelector('.empty-state');
  if (empty) empty.remove();
}

function scrollChat() {
  els.chat.scrollTop = els.chat.scrollHeight;
}

function renderStats(stats = {}) {
  const a = stats.a || {};
  const b = stats.b || {};
  els.agentATotal.textContent = formatNumber(a.totalTokens);
  els.agentBTotal.textContent = formatNumber(b.totalTokens);
  els.agentAInput.textContent = formatNumber(a.inputTokens);
  els.agentBInput.textContent = formatNumber(b.inputTokens);
  els.agentAOutput.textContent = formatNumber(a.outputTokens);
  els.agentBOutput.textContent = formatNumber(b.outputTokens);
  els.combinedTotal.textContent = formatNumber((a.totalTokens || 0) + (b.totalTokens || 0));
  els.agentAEstimate.textContent = a.estimatedTurns ? `${a.estimatedTurns} lượt dùng ước tính token` : '';
  els.agentBEstimate.textContent = b.estimatedTurns ? `${b.estimatedTurns} lượt dùng ước tính token` : '';
}

function applyState(next, { history = false } = {}) {
  state = next;
  els.roomStatus.textContent = next.status;
  els.topicPreview.textContent = next.topic || 'Chưa có chủ đề.';
  els.turnCounter.textContent = `${next.turn || 0} / ${next.maxTurns || 20}`;
  renderStats(next.stats);
  if (history) renderHistory(next.history);

  const active = ['starting', 'running', 'paused', 'pausing'].includes(next.status);
  const running = next.status === 'running' || next.status === 'pausing';
  const paused = next.status === 'paused';
  els.startBtn.disabled = active;
  els.stopBtn.disabled = !active;
  els.pauseBtn.disabled = !running && !paused;
  els.pauseBtn.textContent = paused ? 'Tiếp tục' : (next.status === 'pausing' ? 'Đang tạm dừng…' : 'Tạm dừng');
  const canJoin = Boolean(next.topic) && ['running', 'paused', 'pausing'].includes(next.status);
  els.userInput.disabled = !canJoin;
  els.sendBtn.disabled = !canJoin;
  els.liveHint.textContent = next.currentSpeaker
    ? `${config?.agents?.[next.currentSpeaker]?.name || next.currentSpeaker} đang trả lời...`
    : ({ idle: 'Chưa bắt đầu phiên.', starting: 'Đang chuẩn bị phiên...', paused: 'Đã tạm dừng.', pausing: 'Sẽ tạm dừng sau lượt hiện tại.', stopped: 'Phiên đã dừng.', completed: 'Phiên đã hoàn thành.', error: 'Phiên gặp lỗi.' }[next.status] || 'Sẵn sàng.');
}

function setTopicMode() {
  const auto = els.topicMode.value === 'auto';
  els.topicField.classList.toggle('hidden', auto);
  if (!auto) els.autoStart.checked = false;
  els.autoStart.disabled = !auto;
  localStorage.setItem('ai-chat-auto-start', auto && els.autoStart.checked ? '1' : '0');
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

  applyState(state, { history: true });
  connectEvents();

  if (els.autoStart.checked && state.status === 'idle') {
    els.topicMode.value = 'auto';
    setTopicMode();
    if (!missing.length) await startConversation();
  }
}

function connectEvents() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource('/api/events');
  eventSource.onopen = () => {
    els.connectionDot.classList.add('online');
    els.connectionDot.classList.remove('offline');
    els.connectionText.textContent = 'Realtime';
  };
  eventSource.onerror = () => {
    els.connectionDot.classList.remove('online');
    els.connectionText.textContent = 'Đang nối lại';
  };

  eventSource.addEventListener('state', (event) => applyState(JSON.parse(event.data)));
  eventSource.addEventListener('topic', (event) => {
    const data = JSON.parse(event.data);
    els.topicPreview.textContent = data.topic;
    toast(`Chủ đề: ${data.topic}`);
  });
  eventSource.addEventListener('meta', (event) => toast(JSON.parse(event.data).text));
  eventSource.addEventListener('stats', (event) => renderStats(JSON.parse(event.data)));
  eventSource.addEventListener('room:error', (event) => toast(JSON.parse(event.data).message));

  eventSource.addEventListener('message:start', (event) => {
    const data = JSON.parse(event.data);
    removeEmpty();
    const node = messageNode({ ...data, text: '' }, true);
    streamNodes.set(data.id, node);
    els.chat.append(node.wrapper);
    scrollChat();
  });

  eventSource.addEventListener('message:delta', (event) => {
    const data = JSON.parse(event.data);
    const node = streamNodes.get(data.id);
    if (!node) return;
    node.bubble.textContent += data.delta;
    scrollChat();
  });

  eventSource.addEventListener('message:cancelled', (event) => {
    const data = JSON.parse(event.data);
    const existing = streamNodes.get(data.id);
    if (existing) existing.wrapper.remove();
    streamNodes.delete(data.id);
  });

  eventSource.addEventListener('message:failed', (event) => {
    const data = JSON.parse(event.data);
    const existing = streamNodes.get(data.id);
    if (existing) {
      existing.bubble.classList.remove('typing');
      existing.bubble.classList.add('failed');
      existing.bubble.textContent += existing.bubble.textContent ? '\n\n[Lượt trả lời bị gián đoạn]' : '[Lượt trả lời bị lỗi]';
      streamNodes.delete(data.id);
    }
    toast(data.message || 'AI trả lời thất bại.');
  });

  eventSource.addEventListener('message:done', (event) => {
    const data = JSON.parse(event.data);
    removeEmpty();
    const existing = streamNodes.get(data.id);
    if (existing) {
      existing.bubble.classList.remove('typing');
      existing.bubble.textContent = data.text;
      if (data.usage) existing.usage.textContent = `${formatNumber(data.usage.totalTokens)} token${data.usage.exact === false ? ' ~' : ''}`;
      streamNodes.delete(data.id);
    } else if (!els.chat.querySelector(`[data-message-id="${CSS.escape(data.id)}"]`)) {
      els.chat.append(messageNode(data).wrapper);
    }
    scrollChat();
  });
}

async function startConversation() {
  try {
    const payload = {
      topicMode: els.topicMode.value,
      topic: els.topic.value,
      maxTurns: Number(els.maxTurns.value),
      startSpeaker: els.startSpeaker.value,
      temperature: Number(els.temperature.value),
      maxOutputTokens: Number(els.maxOutputTokens.value),
      sharedPrompt: els.sharedPrompt.value,
      personaA: els.personaA.value,
      personaB: els.personaB.value,
    };
    await api('/api/start', { method: 'POST', body: JSON.stringify(payload) });
  } catch (error) {
    toast(error.message);
  }
}

els.topicMode.addEventListener('change', setTopicMode);
els.autoStart.addEventListener('change', () => {
  localStorage.setItem('ai-chat-auto-start', els.autoStart.checked ? '1' : '0');
});
els.startBtn.addEventListener('click', startConversation);
els.pauseBtn.addEventListener('click', async () => {
  try {
    await api(state?.status === 'paused' ? '/api/resume' : '/api/pause', { method: 'POST', body: '{}' });
  } catch (error) { toast(error.message); }
});
els.stopBtn.addEventListener('click', async () => {
  try { await api('/api/stop', { method: 'POST', body: '{}' }); } catch (error) { toast(error.message); }
});
els.resetBtn.addEventListener('click', async () => {
  try {
    const next = await api('/api/reset', { method: 'POST', body: '{}' });
    applyState(next, { history: true });
  } catch (error) { toast(error.message); }
});
els.userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = els.userInput.value.trim();
  if (!text) return;
  els.userInput.value = '';
  try {
    await api('/api/message', { method: 'POST', body: JSON.stringify({ text }) });
  } catch (error) {
    els.userInput.value = text;
    toast(error.message);
  }
});

setTopicMode();
load().catch((error) => toast(error.message));
