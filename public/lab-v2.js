const $ = (id) => document.getElementById(id);
const extraPersonaKey = window.__AI_CHAT_DB__?.extraPersonasKey || 'ai-chat-extra-personas-v1';
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

function readExtraPersonas() {
  const parsed = safeJson(localStorage.getItem(extraPersonaKey), {});
  return parsed && typeof parsed === 'object' ? parsed : {};
}

function saveExtraPersonas() {
  const next = { c: $('personaC')?.value || '', d: $('personaD')?.value || '' };
  try { localStorage.setItem(extraPersonaKey, JSON.stringify(next)); } catch {}
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
  const promptDetails = $('promptPanel');
  const promptButtons = promptDetails?.querySelector('.two-cols');
  const extra = readExtraPersonas();

  for (const id of ['c', 'd']) {
    const agent = config?.agents?.[id];
    if (!agent?.configured) continue;
    if (!$(`agent${id.toUpperCase()}Total`) && stats) stats.insertBefore(createExtraAgentCard(id, agent), roomMini);
    if (!$(`persona${id.toUpperCase()}`) && promptDetails && promptButtons) {
      const label = document.createElement('label');
      label.className = 'field';
      label.innerHTML = `<span><i class="agent-dot ${id}"></i> Persona Agent ${id.toUpperCase()}</span><textarea id="persona${id.toUpperCase()}" rows="4" placeholder="Tính cách riêng cho ${agent.name}."></textarea>`;
      promptDetails.insertBefore(label, promptButtons);
      const field = label.querySelector('textarea');
      field.value = extra[id] || '';
      field.addEventListener('input', saveExtraPersonas);
    }
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

const PRESETS = {
  default: { label: 'Mặc định', mode: 'turns', shared: null, personas: {} },
  debate: {
    label: 'Tranh biện', mode: 'turns',
    shared: 'Hãy tranh luận có cấu trúc. Nêu luận điểm rõ, phản biện trực tiếp, yêu cầu bằng chứng khi cần và sẵn sàng đổi ý nếu đối phương chứng minh tốt hơn. Không đồng ý xã giao.',
    personas: { a: 'Bảo vệ luận điểm chính nhưng không cố chấp. Ưu tiên bằng chứng và tính nhất quán.', b: 'Đóng vai phản biện mạnh, tìm lỗ hổng, phản ví dụ và giả định ẩn.', c: 'Đóng vai trọng tài phân tích, chỉ ra bên nào có bằng chứng mạnh hơn và vì sao.', d: 'Đưa góc nhìn thứ ba hoặc giải pháp dung hòa khi hai bên mắc kẹt.' },
  },
  brainstorm: {
    label: 'Brainstorm', mode: 'parallel',
    shared: 'Ưu tiên tạo ý tưởng mới, cụ thể và khác nhau. Không vội bác bỏ; mở rộng ý hay của người khác, sau đó mới lọc theo tính khả thi. Tránh lặp ý.',
    personas: { a: 'Sinh ý tưởng thực dụng.', b: 'Sinh ý tưởng táo bạo.', c: 'Tìm biến thể và kết hợp ý tưởng.', d: 'Đánh giá rủi ro và cách triển khai.' },
  },
  codeReview: {
    label: 'Review code', mode: 'turns',
    shared: 'Review kỹ thuật như một nhóm senior engineer. Ưu tiên correctness, security, concurrency, maintainability, testability và hiệu năng. Chỉ ra lỗi cụ thể trước, đề xuất sửa sau. Không khen lấy lệ.',
    personas: { a: 'Tập trung kiến trúc và correctness.', b: 'Tập trung bug, edge case và test.', c: 'Tập trung security và dữ liệu.', d: 'Tập trung hiệu năng, DX và độ đơn giản.' },
  },
  factCheck: {
    label: 'Fact-check', mode: 'turns',
    shared: 'Mọi tuyên bố thực tế quan trọng phải được kiểm chứng. Ưu tiên nguồn gốc, nguồn chính thức và nhiều nguồn độc lập. Phân biệt rõ dữ kiện, suy luận và phần chưa chắc chắn. Dùng web khi thông tin có thể thay đổi.',
    personas: { a: 'Tìm và trình bày bằng chứng ủng hộ.', b: 'Tìm bằng chứng phản bác hoặc ngoại lệ.', c: 'Đánh giá chất lượng nguồn.', d: 'Tổng hợp verdict cuối cùng với mức độ tin cậy.' },
  },
  socratic: {
    label: 'Socratic', mode: 'turns',
    shared: 'Khám phá vấn đề bằng câu hỏi chính xác, mỗi lượt chỉ đào sâu một nút thắt. Không biến hội thoại thành bài giảng dài. Chỉ kết luận khi các giả định quan trọng đã được kiểm tra.',
    personas: { a: 'Hỏi về định nghĩa và giả định.', b: 'Hỏi về bằng chứng và phản ví dụ.', c: 'Hỏi về hệ quả.', d: 'Tóm tắt điều đã biết và câu hỏi còn mở.' },
  },
};

function ensurePresetUi() {
  if ($('conversationPreset')) return;
  const sessionSection = document.querySelector('[aria-labelledby="sessionSectionLabel"]');
  if (!sessionSection) return;
  const field = document.createElement('label');
  field.className = 'field lab-preset-field';
  field.innerHTML = '<span>Preset phòng</span><select id="conversationPreset"></select><small>Preset thay cả cách điều phối và persona, không chỉ đổi một câu prompt cho có.</small>';
  sessionSection.insertBefore(field, sessionSection.children[1] || null);
  const select = field.querySelector('select');
  for (const [key, preset] of Object.entries(PRESETS)) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = preset.label;
    select.append(option);
  }
  select.addEventListener('change', () => applyPreset(select.value));
}

function setField(id, value) {
  const field = $(id);
  if (!field || value == null) return;
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
}

function applyPreset(key) {
  const preset = PRESETS[key] || PRESETS.default;
  setField('conversationMode', preset.mode);
  if (key === 'default') setField('sharedPrompt', config?.defaults?.sharedPrompt || '');
  else setField('sharedPrompt', `${config?.defaults?.sharedPrompt || ''}\n\nQUY TẮC PRESET:\n${preset.shared}`);
  for (const id of ['a', 'b', 'c', 'd']) setField(`persona${id.toUpperCase()}`, preset.personas[id] || '');
  saveExtraPersonas();
}

function createInspector() {
  if (inspectorDrawer) return;
  inspectorDrawer = document.createElement('aside');
  inspectorDrawer.className = 'lab-inspector';
  inspectorDrawer.setAttribute('aria-hidden', 'true');
  inspectorDrawer.innerHTML = '<div class="lab-inspector-head"><div><div class="eyebrow">DEBUG TIMELINE</div><h2>Inspector</h2></div><button class="icon-button" id="closeLabInspector">×</button></div><div class="lab-inspector-body"></div>';
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
    sharedPrompt: $('sharedPrompt')?.value || config?.defaults?.sharedPrompt || '',
    personaA: $('personaA')?.value || '',
    personaB: $('personaB')?.value || '',
  };
}

async function forkFromMessage(messageId) {
  const source = findSessionForMessage(messageId);
  if (!source) return;
  const index = source.history.findIndex((item) => item.id === messageId);
  if (index < 0) return;
  const history = source.history.slice(0, index + 1);
  const usedTurns = history.filter((item) => /^[a-d]$/.test(item.speaker || '')).length;
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
  ensureExtraAgentUi(); ensurePresetUi(); createInspector(); addRoomBadge(); connectLabEvents(); decorateMessages(document);
  const observer = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1) decorateMessages(node.matches?.('.message') ? node.parentElement : node);
  });
  if ($('chat')) observer.observe($('chat'), { childList: true, subtree: true });
  setInterval(() => persistIndexedDb(latestState), 2500);
}

init().catch((error) => console.error('Lab v2 init failed', error));
