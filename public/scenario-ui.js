const $ = (id) => document.getElementById(id);
const HISTORY_KEY = 'ai-chat-history-v1';
const DEFAULT_WEREWOLF_TOPIC = 'Ma Sói: suy luận, thảo luận và bỏ phiếu theo luật backend.';
const ACTIVE_STATUSES = new Set(['starting', 'running', 'paused', 'pausing']);

const PHASE_LABELS = Object.freeze({
  setup: 'Chuẩn bị',
  night: 'Đêm',
  night_resolution: 'Đang xử lý đêm',
  day_discussion: 'Ban ngày · thảo luận',
  day_vote: 'Ban ngày · bỏ phiếu',
  day_resolution: 'Đang xử lý phiếu',
  completed: 'Kết thúc',
});

let config = null;
let latestState = null;
let configuredCount = 0;

function safeHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function agentName(id) {
  return config?.agents?.[id]?.name || String(id || '').toUpperCase();
}

function scenarioForMessage(messageId) {
  if (!messageId) return null;
  if (latestState?.history?.some((item) => item.id === messageId)) return latestState?.scenario || null;
  return safeHistory().find((session) => session?.history?.some((item) => item.id === messageId))?.scenario || null;
}

function visibleScenario() {
  const historyBanner = $('historyViewBanner');
  if (historyBanner && !historyBanner.classList.contains('hidden')) {
    const firstMessage = document.querySelector('#chat .message[data-message-id]');
    return scenarioForMessage(firstMessage?.dataset?.messageId) || null;
  }
  return latestState?.scenario || null;
}

function latestPublicEvent(scenario) {
  const events = scenario?.state?.events;
  return Array.isArray(events) && events.length ? events[events.length - 1] : null;
}

function eventText(event) {
  if (!event) return '';
  if (event.type === 'night_death') return `${agentName(event.agentId)} đã chết trong đêm.`;
  if (event.type === 'night_safe') return 'Đêm qua không ai chết.';
  if (event.type === 'vote_elimination') return `${agentName(event.agentId)} bị loại sau bỏ phiếu.`;
  if (event.type === 'vote_tie') return 'Bỏ phiếu hòa, không ai bị loại.';
  if (event.type === 'day_started') return 'Ban ngày bắt đầu.';
  if (event.type === 'day_vote_started') return 'Đã chuyển sang bỏ phiếu.';
  if (event.type === 'night_started') return 'Màn đêm buông xuống.';
  if (event.type === 'victory') return event.winner === 'wolves' ? 'Phe Ma Sói thắng.' : 'Phe Dân Làng thắng.';
  return '';
}

export function scenarioStatusText(scenario, names = {}) {
  if (!scenario?.id) return '';
  const state = scenario.state || {};
  const phase = PHASE_LABELS[scenario.phase] || scenario.phase || 'Đang chạy';
  const day = Number(state.day || 0);
  const alive = Array.isArray(state.alive) ? state.alive.map((id) => names[id] || String(id).toUpperCase()) : [];
  const dead = Array.isArray(state.dead) ? state.dead.map((id) => names[id] || String(id).toUpperCase()) : [];
  const lines = [`Ma Sói · ${phase}${day ? ` · Ngày ${day}` : ''}`];
  if (alive.length) lines.push(`Còn sống: ${alive.join(', ')}`);
  if (dead.length) lines.push(`Đã chết: ${dead.join(', ')}`);
  const last = Array.isArray(state.events) ? state.events[state.events.length - 1] : null;
  if (last?.type === 'night_death') lines.push(`${names[last.agentId] || String(last.agentId || '').toUpperCase()} đã chết trong đêm.`);
  else if (last?.type === 'night_safe') lines.push('Đêm qua không ai chết.');
  else if (last?.type === 'vote_elimination') lines.push(`${names[last.agentId] || String(last.agentId || '').toUpperCase()} bị loại sau bỏ phiếu.`);
  else if (last?.type === 'vote_tie') lines.push('Bỏ phiếu hòa, không ai bị loại.');
  else if (last?.type === 'victory') lines.push(last.winner === 'wolves' ? 'Phe Ma Sói thắng.' : 'Phe Dân Làng thắng.');
  return lines.join('\n');
}

function renderScenarioStatus() {
  const panel = $('scenarioStatus');
  if (!panel) return;
  const scenario = visibleScenario();
  if (!scenario?.id) {
    panel.classList.add('hidden');
    panel.replaceChildren();
    return;
  }

  const state = scenario.state || {};
  const title = document.createElement('strong');
  title.textContent = `Ma Sói · ${PHASE_LABELS[scenario.phase] || scenario.phase || 'Đang chạy'}${state.day ? ` · Ngày ${state.day}` : ''}`;
  const meta = document.createElement('span');
  const alive = Array.isArray(state.alive) ? state.alive.map(agentName) : [];
  const dead = Array.isArray(state.dead) ? state.dead.map(agentName) : [];
  meta.className = 'scenario-meta';
  meta.textContent = [
    alive.length ? `Còn sống: ${alive.join(', ')}` : '',
    dead.length ? `Đã chết: ${dead.join(', ')}` : '',
  ].filter(Boolean).join(' · ');
  const event = document.createElement('span');
  event.className = 'scenario-event';
  event.textContent = eventText(latestPublicEvent(scenario));

  panel.replaceChildren(title);
  if (meta.textContent) panel.append(meta);
  if (event.textContent) panel.append(event);
  panel.classList.remove('hidden');
}

function syncScenarioControls() {
  const select = $('scenarioMode');
  if (!select) return;
  const werewolfOption = [...select.options].find((option) => option.value === 'werewolf');
  if (werewolfOption) werewolfOption.disabled = configuredCount < 4;

  if (latestState?.scenario?.id) select.value = latestState.scenario.id;
  const active = ACTIVE_STATUSES.has(latestState?.status);
  select.disabled = active;
  const werewolf = select.value === 'werewolf';
  const conversationMode = $('conversationMode');
  const topicMode = $('topicMode');
  const startSpeaker = $('startSpeaker');
  const autoStart = $('autoStart');
  const topic = $('topic');
  const help = $('scenarioHelp');

  if (werewolf && configuredCount >= 4) {
    if (conversationMode) { conversationMode.value = 'turns'; conversationMode.disabled = true; }
    if (topicMode) { topicMode.value = 'manual'; topicMode.disabled = true; topicMode.dispatchEvent(new Event('change', { bubbles: true })); }
    if (startSpeaker) startSpeaker.disabled = true;
    if (autoStart) { autoStart.checked = false; autoStart.disabled = true; }
    if (topic && !topic.value.trim()) {
      topic.value = DEFAULT_WEREWOLF_TOPIC;
      topic.dataset.scenarioDefault = 'werewolf';
    }
    if (help) help.textContent = 'Backend giữ role, phase và legal action. Hỗ trợ 4–6 AI, chỉ chạy theo lượt; role bí mật không được gửi ra UI.';
  } else {
    if (conversationMode) conversationMode.disabled = active;
    if (topicMode) { topicMode.disabled = active; topicMode.dispatchEvent(new Event('change', { bubbles: true })); }
    if (startSpeaker) startSpeaker.disabled = active;
    if (topic?.dataset?.scenarioDefault === 'werewolf' && topic.value === DEFAULT_WEREWOLF_TOPIC) topic.value = '';
    if (topic) delete topic.dataset.scenarioDefault;
    if (help) help.textContent = configuredCount < 4
      ? `Ma Sói cần 4–6 AI đã cấu hình; hiện có ${configuredCount}.`
      : 'Ma Sói dùng backend làm trọng tài deterministic; AI chỉ quyết định lời nói và hành động hợp lệ.';
  }
}

function removeScenarioForkButtons(root = document) {
  for (const message of root.querySelectorAll?.('.message[data-message-id]') || []) {
    const scenario = scenarioForMessage(message.dataset.messageId);
    if (!scenario?.id) continue;
    for (const button of message.querySelectorAll('.lab-message-actions button')) {
      if (button.textContent?.trim().toLowerCase() === 'fork') button.remove();
    }
  }
}

function onState(next) {
  latestState = next;
  syncScenarioControls();
  renderScenarioStatus();
  queueMicrotask(() => removeScenarioForkButtons(document));
}

async function init() {
  const [nextConfig, nextState] = await Promise.all([
    fetch('/api/config', { cache: 'no-store' }).then((response) => response.json()),
    fetch('/api/state', { cache: 'no-store' }).then((response) => response.json()),
  ]);
  config = nextConfig;
  configuredCount = Object.values(config?.agents || {}).filter((agent) => agent?.configured).length;
  onState(nextState);

  $('scenarioMode')?.addEventListener('change', () => {
    syncScenarioControls();
    renderScenarioStatus();
  });
  $('returnLiveBtn')?.addEventListener('click', () => setTimeout(renderScenarioStatus, 0));
  $('historyList')?.addEventListener('click', () => setTimeout(() => {
    renderScenarioStatus();
    removeScenarioForkButtons(document);
  }, 0));

  const events = new EventSource('/api/events');
  events.addEventListener('state', (event) => onState(JSON.parse(event.data)));

  const observer = new MutationObserver(() => {
    queueMicrotask(() => {
      renderScenarioStatus();
      removeScenarioForkButtons(document);
    });
  });
  const chat = $('chat');
  const banner = $('historyViewBanner');
  if (chat) observer.observe(chat, { childList: true, subtree: true });
  if (banner) observer.observe(banner, { attributes: true, attributeFilter: ['class'] });
}

if (typeof document !== 'undefined') init().catch((error) => console.error('Scenario UI init failed', error));
