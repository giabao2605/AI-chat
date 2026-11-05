import { countHistoryAiTurns } from './history-resume.js';

const $ = (id) => document.getElementById(id);
const historyKey = 'ai-chat-history-v1';
let config = null;
let latestState = null;
let lastHistoryBackup = '';
let inspectorDrawer = null;
let inspectorBody = null;

function safeJson(raw, fallback = null) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Number(value || 0));
}

async function dbPut(store, value, key) {
  const db = await window.__AI_CHAT_DB__?.openDb?.();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      if (key === undefined) tx.objectStore(store).put(value);
      else tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

function persistIndexedDb(state) {
  if (state?.runId && state?.topic && Array.isArray(state.history) && state.history.length) {
    void dbPut('sessions', {
      runId: state.runId,
      topic: state.topic,
      status: state.status,
      conversationMode: state.conversationMode,
      turn: state.turn,
      maxTurns: state.maxTurns,
      history: state.history,
      stats: state.stats,
      debugEvents: state.debugEvents || [],
      context: state.context || {},
      savedAt: new Date().toISOString(),
    });
  }
  const raw = localStorage.getItem(historyKey) || '';
  if (raw && raw !== lastHistoryBackup) {
    lastHistoryBackup = raw;
    void dbPut('kv', raw, 'history-backup');
  }
}

function createExtraAgentCard(id, agent) {
  const card = document.createElement('div');
  card.className = `mini-stat agent-${id}-mini`;
  card.title = `Token Agent ${id.toUpperCase()}`;
  card.innerHTML = `<span>${agent.name}</span><strong id="agent${id.toUpperCase()}Total">0</strong><small><span>${agent.model || '-'}</span> · In <b id="agent${id.toUpperCase()}Input">0</b> / Out <b id="agent${id.toUpperCase()}Output">0</b></small><i id="agent${id.toUpperCase()}Estimate"></i>`;
  return card;
}

function ensureExtraAgentUi() {
  const roomMini = document.querySelector('.room-mini');
  const stats = document.querySelector('.compact-stats');

  for (const id of ['c', 'd']) {
    const agent = config?.agents?.[id];
    if (!agent?.configured) continue;
    if (!$(`agent${id.toUpperCase()}Total`) && stats) stats.insertBefore(createExtraAgentCard(id, agent), roomMini);
    const startSpeaker = $('startSpeaker');
    if (startSpeaker && ![...startSpeaker.options].some((option) => option.value === id)) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = agent.name;
      startSpeaker.append(option);
    }
  }
}

function updateAllStats(stats = {}) {
  for (const [id, value] of Object.entries(stats)) {
    const upper = id.toUpperCase();
    if ($(`agent${upper}Total`)) $(`agent${upper}Total`).textContent = formatNumber(value.totalTokens);
    if ($(`agent${upper}Input`)) $(`agent${upper}Input`).textContent = formatNumber(value.inputTokens);
    if ($(`agent${upper}Output`)) $(`agent${upper}Output`).textContent = formatNumber(value.outputTokens);
    if ($(`agent${upper}Estimate`)) $(`agent${upper}Estimate`).textContent = value.estimatedTurns ? '~' : '';
  }
  const total = Object.values(stats).reduce((sum, value) => sum + Number(value?.totalTokens || 0), 0);
  if ($('combinedTotal')) $('combinedTotal').textContent = formatNumber(total);
}

function createInspector() {
  if (inspectorDrawer) return;
  inspectorDrawer = document.createElement('aside');
  inspectorDrawer.className = 'lab-inspector';
  inspectorDrawer.setAttribute('aria-hidden', 'true');
  inspectorDrawer.innerHTML = '<div class="lab-inspector-head"><div><h2>Inspector</h2></div><button class="icon-button" id="closeLabInspector">Đóng</button></div><div class="lab-inspector-body"></div>';
  document.body.append(inspectorDrawer);
  inspectorBody = inspectorDrawer.querySelector('.lab-inspector-body');
  $('closeLabInspector').addEventListener('click', () => toggleInspector(false));
  const toolbar = document.querySelector('.toolbar-actions');
  if (toolbar && !$('openLabInspector')) {
    const button = document.createElement('button');
    button.id = 'openLabInspector';
    button.className = 'button ghost';
    button.type = 'button';
    button.textContent = 'Inspector';
    button.addEventListener('click', () => { renderInspector(); toggleInspector(true); });
    toolbar.prepend(button);
  }
}

function toggleInspector(open) {
  if (!inspectorDrawer) return;
  inspectorDrawer.classList.toggle('open', open);
  inspectorDrawer.setAttribute('aria-hidden', String(!open));
}

function renderInspector(message = null) {
  if (!inspectorBody) return;
  inspectorBody.innerHTML = '';
  const room = document.createElement('div');
  room.className = 'lab-debug-card';
  const roomId = window.__AI_CHAT_ROOM_ID__ || 'default-room';
  room.innerHTML = `<strong>Room</strong><span>${roomId}</span><span>${latestState?.activeAgents?.length || Object.keys(config?.agents || {}).length} agent · ${latestState?.turn || 0}/${latestState?.maxTurns || 0} lượt</span><span>Context summary: ${latestState?.context?.summaryChars || 0} ký tự</span>`;
  inspectorBody.append(room);
  if (message) {
    const card = document.createElement('div');
    card.className = 'lab-debug-card focus';
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify({ speaker: message.speaker, usage: message.usage, sources: message.sources, debug: message.debug }, null, 2);
    card.append(Object.assign(document.createElement('strong'), { textContent: `${message.name} · message debug` }), pre);
    inspectorBody.append(card);
  }
  const events = [...(latestState?.debugEvents || [])].reverse().slice(0, 60);
  for (const event of events) {
    const card = document.createElement('div');
    card.className = 'lab-debug-card';
    const title = document.createElement('strong');
    title.textContent = event.type;
    const meta = document.createElement('span');
    meta.textContent = `${event.agentId ? `${event.agentId.toUpperCase()} · ` : ''}${new Date(event.at).toLocaleTimeString('vi-VN')}`;
    const pre = document.createElement('pre');
    const clone = { ...event }; delete clone.type; delete clone.at; delete clone.id;
    pre.textContent = JSON.stringify(clone, null, 2);
    card.append(title, meta, pre);
    inspectorBody.append(card);
  }
}

function findSessionForMessage(messageId) {
  if (latestState?.history?.some((item) => item.id === messageId)) return latestState;
  const sessions = safeJson(localStorage.getItem(historyKey), []);
  return Array.isArray(sessions) ? sessions.find((session) => session?.history?.some((item) => item.id === messageId)) : null;
}

function startPayloadForBranch(maxTurns) {
  return {
    maxTurns,
    conversationMode: $('conversationMode')?.value || 'turns',
    temperature: Number($('temperature')?.value || 0.8),
    maxOutputTokens: Number($('maxOutputTokens')?.value || 1200),
  };
}

async function forkFromMessage(messageId) {
  const source = findSessionForMessage(messageId);
  if (!source) return;
  const index = source.history.findIndex((item) => item.id === messageId);
  if (index < 0) return;
  const history = source.history.slice(0, index + 1);
  const usedTurns = countHistoryAiTurns(history);
  const session = {
    runId: source.runId,
    topic: source.topic,
    status: 'stopped',
    conversationMode: source.conversationMode || 'turns',
    maxTurns: Math.max(usedTurns + 20, Number(source.maxTurns || 20)),
    history,
    stats: {},
  };
  try {
    if (['starting', 'running', 'paused', 'pausing'].includes(latestState?.status)) await fetch('/api/stop', { method: 'POST', body: '{}' });
    const maxTurns = Math.max(usedTurns + 20, Number($('maxTurns')?.value || 20));
    await fetch('/api/continue', { method: 'POST', body: JSON.stringify({ session, ...startPayloadForBranch(maxTurns) }) });
    $('returnLiveBtn')?.click();
  } catch (error) {
    console.error('Fork conversation failed', error);
  }
}

function decorateMessages(root = document) {
  for (const message of root.querySelectorAll?.('.message[data-message-id]') || []) {
    if (message.querySelector('.lab-message-actions')) continue;
    const meta = message.querySelector('.message-meta');
    if (!meta) continue;
    const actions = document.createElement('span');
    actions.className = 'lab-message-actions';
    const inspect = document.createElement('button');
    inspect.type = 'button'; inspect.textContent = 'debug'; inspect.title = 'Xem debug lượt này';
    inspect.addEventListener('click', (event) => {
      event.stopPropagation();
      const item = findSessionForMessage(message.dataset.messageId)?.history?.find((entry) => entry.id === message.dataset.messageId);
      renderInspector(item || null); toggleInspector(true);
    });
    const fork = document.createElement('button');
    fork.type = 'button'; fork.textContent = 'fork'; fork.title = 'Tạo nhánh từ tin nhắn này';
    fork.addEventListener('click', (event) => { event.stopPropagation(); void forkFromMessage(message.dataset.messageId); });
    actions.append(inspect, fork); meta.append(actions);
  }
}

function addRoomBadge() {
  const status = document.querySelector('.status-wrap');
  if (!status || $('roomIdBadge')) return;
  const badge = document.createElement('span');
  badge.id = 'roomIdBadge'; badge.className = 'status-pill lab-room-badge';
  badge.textContent = `room ${String(window.__AI_CHAT_ROOM_ID__ || '').slice(-6)}`;
  badge.title = window.__AI_CHAT_ROOM_ID__ || '';
  status.append(badge);
}

function connectLabEvents() {
  const events = new EventSource('/api/events');
  events.addEventListener('state', (event) => {
    latestState = JSON.parse(event.data);
    updateAllStats(latestState.stats || {});
    persistIndexedDb(latestState);
    if (inspectorDrawer?.classList.contains('open')) renderInspector();
    queueMicrotask(() => decorateMessages(document));
  });
  events.addEventListener('stats', (event) => updateAllStats(JSON.parse(event.data)));
  events.addEventListener('message:done', () => setTimeout(() => decorateMessages(document), 0));
  events.addEventListener('debug', () => { if (inspectorDrawer?.classList.contains('open')) renderInspector(); });
}

async function init() {
  config = await fetch('/api/config', { cache: 'no-store' }).then((response) => response.json());
  ensureExtraAgentUi(); createInspector(); addRoomBadge(); connectLabEvents(); decorateMessages(document);
  const observer = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) decorateMessages(node.matches?.('.message') ? node.parentElement : node);
  });
  if ($('chat')) observer.observe($('chat'), { childList: true, subtree: true });
  setInterval(() => persistIndexedDb(latestState), 2500);
}

init().catch((error) => console.error('Lab v2 init failed', error));
