const $ = (id) => document.getElementById(id);

const els = {
  button: $('memoryInspectorBtn'),
  count: $('memoryCount'),
  drawer: $('memoryDrawer'),
  backdrop: $('memoryBackdrop'),
  close: $('closeMemoryBtn'),
  refresh: $('refreshMemoryBtn'),
  clear: $('clearAgentMemoryBtn'),
  tabs: $('memoryAgentTabs'),
  query: $('memoryQuery'),
  type: $('memoryTypeFilter'),
  inactive: $('memoryIncludeInactive'),
  summary: $('memorySummary'),
  list: $('memoryList'),
  status: $('memoryInspectorStatus'),
};

let agents = {};
let currentAgent = '';
let loading = false;
let queryTimer = null;

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function percent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number * 100)}%` : '—';
}

function shortId(value, length = 12) {
  const text = String(value || '');
  return text.length > length ? `${text.slice(0, length)}…` : text || '—';
}

function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
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

function setStatus(message = '', kind = '') {
  if (!els.status) return;
  els.status.textContent = message;
  els.status.className = `memory-inspector-status${kind ? ` ${kind}` : ''}`;
}

function setLoading(value) {
  loading = Boolean(value);
  if (els.refresh) els.refresh.disabled = loading;
  if (els.clear) els.clear.disabled = loading || !currentAgent;
  if (els.query) els.query.disabled = loading;
  if (els.type) els.type.disabled = loading;
  if (els.inactive) els.inactive.disabled = loading;
  if (loading) setStatus('Đang đọc SQLite memory…');
}

function configuredAgentEntries(config) {
  return Object.entries(config?.agents || {})
    .filter(([, agent]) => agent?.configured !== false)
    .map(([id, agent]) => [id, agent]);
}

function renderAgentTabs() {
  if (!els.tabs) return;
  els.tabs.replaceChildren();
  for (const [id, agent] of Object.entries(agents)) {
    const button = node('button', `memory-agent-tab${id === currentAgent ? ' active' : ''}`);
    button.type = 'button';
    button.dataset.agentId = id;
    const name = node('span', '', agent.name || id.toUpperCase());
    const count = node('b', '', String(agent.stats?.total ?? '…'));
    button.append(name, count);
    button.addEventListener('click', () => {
      if (id === currentAgent || loading) return;
      currentAgent = id;
      renderAgentTabs();
      void loadMemory();
    });
    els.tabs.append(button);
  }
}

function memoryTypeLabel(type) {
  return ({
    semantic: 'SEMANTIC',
    episodic: 'EPISODE',
    belief: 'BELIEF',
    relationship: 'RELATIONSHIP',
    private: 'PRIVATE',
    procedural: 'PROCEDURAL',
  })[type] || String(type || 'MEMORY').toUpperCase();
}

function renderMemoryCard(memory) {
  const card = node('article', `memory-card${memory.active ? '' : ' inactive'}${memory.retrievalPreview?.activated ? ' activated' : ''}`);

  const head = node('div', 'memory-card-head');
  const badges = node('div', 'memory-card-badges');
  badges.append(node('span', `memory-type type-${memory.type}`, memoryTypeLabel(memory.type)));
  badges.append(node('span', `memory-state ${memory.active ? 'active' : 'inactive'}`, memory.active ? 'ACTIVE' : 'FORGOTTEN'));
  if (memory.retrievalPreview?.activated) badges.append(node('span', 'memory-activation', 'SẼ RETRIEVE'));
  if (memory.forgottenRun) badges.append(node('span', 'memory-run-forgotten', 'RUN ĐÃ XÓA'));

  const actions = node('div', 'memory-card-actions');
  if (memory.active) {
    const forget = node('button', 'memory-forget-button', 'Quên');
    forget.type = 'button';
    forget.title = 'Deactivate memory này';
    forget.addEventListener('click', async () => {
      const name = agents[currentAgent]?.name || currentAgent;
      if (!window.confirm(`Quên memory này của ${name}? Memory sẽ bị deactivate và không còn được retrieve.`)) return;
      forget.disabled = true;
      try {
        await api('/api/memory/forget', {
          method: 'POST',
          body: JSON.stringify({ agentId: currentAgent, memoryId: memory.id }),
        });
        setStatus('Đã quên memory.', 'success');
        await loadMemory({ quiet: true });
      } catch (error) {
        setStatus(error?.message || String(error), 'error');
        forget.disabled = false;
      }
    });
    actions.append(forget);
  }
  head.append(badges, actions);

  const content = node('p', 'memory-content', memory.content || '(trống)');

  const metrics = node('div', 'memory-metrics');
  const metricItems = [
    ['Importance', percent(memory.importance)],
    ['Confidence', percent(memory.confidence)],
    ['Relevance', els.query?.value.trim() ? percent(memory.retrievalPreview?.relevance || 0) : '—'],
    ['Token trùng', els.query?.value.trim() ? String(memory.retrievalPreview?.sharedTokens || 0) : '—'],
    ['Đã dùng', String(memory.accessCount || 0)],
  ];
  for (const [label, value] of metricItems) {
    const item = node('div', 'memory-metric');
    item.append(node('span', '', label), node('b', '', value));
    metrics.append(item);
  }

  const meta = node('dl', 'memory-meta');
  const rows = [
    ['Key', memory.key || '—'],
    ['Run', memory.runId || '—'],
    ['Source', memory.sourceType || '—'],
    ['Retention', memory.metadata?.retention || 'legacy/unknown'],
    ['Cập nhật', formatDate(memory.updatedAt)],
    ['Truy cập cuối', formatDate(memory.lastAccessedAt)],
  ];
  for (const [label, value] of rows) {
    const dt = node('dt', '', label);
    const dd = node('dd', '', label === 'Run' ? shortId(value, 18) : String(value));
    if (label === 'Run') dd.title = String(value);
    meta.append(dt, dd);
  }

  card.append(head, content, metrics, meta);
  return card;
}

function renderMemoryList(payload) {
  const agent = payload?.agents?.[currentAgent];
  if (!agent || !els.list) return;
  agents[currentAgent] = { ...agents[currentAgent], ...agent };
  renderAgentTabs();

  const memories = Array.isArray(agent.memories) ? agent.memories : [];
  const activated = memories.filter((item) => item.retrievalPreview?.activated).length;
  if (els.summary) {
    const parts = [`${agent.stats?.total || 0} memory active`, `${memories.length} đang hiển thị`];
    if (els.query?.value.trim()) parts.push(`${activated} memory sẽ được retrieve`);
    els.summary.textContent = parts.join(' · ');
  }
  if (els.clear) els.clear.textContent = `Xóa toàn bộ memory của ${agent.name || currentAgent.toUpperCase()}`;

  els.list.replaceChildren();
  if (!memories.length) {
    const empty = node('div', 'memory-empty');
    empty.append(
      node('strong', '', 'Không có memory phù hợp.'),
      node('p', '', els.query?.value.trim()
        ? 'Query này không làm memory nào trong danh sách hiện tại trở nên liên quan.'
        : 'Agent này chưa có memory, hoặc filter hiện tại đã loại hết.'),
    );
    els.list.append(empty);
    return;
  }
  for (const memory of memories) els.list.append(renderMemoryCard(memory));
}

function buildMemoryUrl() {
  const params = new URLSearchParams({ agent: currentAgent, limit: '300' });
  const query = els.query?.value.trim() || '';
  const type = els.type?.value || '';
  if (query) params.set('query', query);
  if (type) params.set('type', type);
  if (els.inactive?.checked) params.set('includeInactive', 'true');
  return `/api/memory?${params}`;
}

async function loadMemory({ quiet = false } = {}) {
  if (!currentAgent || loading) return;
  setLoading(true);
  try {
    const payload = await api(buildMemoryUrl());
    renderMemoryList(payload);
    if (!quiet) setStatus('Memory inspector đã cập nhật.', 'success');
  } catch (error) {
    setStatus(error?.message || String(error), 'error');
    if (els.list) {
      els.list.replaceChildren(node('div', 'memory-empty error', 'Không đọc được memory.'));
    }
  } finally {
    setLoading(false);
  }
}

async function loadAgentOverview() {
  try {
    const [config, overview] = await Promise.all([
      api('/api/config'),
      api('/api/memory?limit=1'),
    ]);
    const configured = Object.fromEntries(configuredAgentEntries(config));
    agents = {};
    for (const [id, agent] of Object.entries(configured)) {
      const memory = overview?.agents?.[id] || {};
      agents[id] = {
        name: memory.name || agent.name || id.toUpperCase(),
        model: memory.model || agent.model || '',
        stats: memory.stats || { total: 0, byType: {} },
      };
    }
    const total = Object.values(agents).reduce((sum, agent) => sum + Number(agent.stats?.total || 0), 0);
    if (els.count) els.count.textContent = String(total);
    if (!currentAgent || !agents[currentAgent]) currentAgent = Object.keys(agents)[0] || '';
    renderAgentTabs();
    return Boolean(currentAgent);
  } catch (error) {
    if (els.count) els.count.textContent = '—';
    setStatus(error?.message || String(error), 'error');
    return false;
  }
}

async function openDrawer() {
  if (!els.drawer || !els.backdrop) return;
  els.drawer.classList.add('open');
  els.drawer.setAttribute('aria-hidden', 'false');
  els.backdrop.classList.remove('hidden');
  const ready = await loadAgentOverview();
  if (ready) await loadMemory({ quiet: true });
}

function closeDrawer() {
  els.drawer?.classList.remove('open');
  els.drawer?.setAttribute('aria-hidden', 'true');
  els.backdrop?.classList.add('hidden');
}

els.button?.addEventListener('click', () => { void openDrawer(); });
els.close?.addEventListener('click', closeDrawer);
els.backdrop?.addEventListener('click', closeDrawer);
els.refresh?.addEventListener('click', () => { void loadMemory(); });
els.type?.addEventListener('change', () => { void loadMemory({ quiet: true }); });
els.inactive?.addEventListener('change', () => { void loadMemory({ quiet: true }); });
els.query?.addEventListener('input', () => {
  clearTimeout(queryTimer);
  queryTimer = setTimeout(() => { void loadMemory({ quiet: true }); }, 280);
});
els.clear?.addEventListener('click', async () => {
  if (!currentAgent || loading) return;
  const name = agents[currentAgent]?.name || currentAgent;
  if (!window.confirm(`Xóa TOÀN BỘ memory của ${name}? Thao tác này hard-delete các memory record hiện có của agent này.`)) return;
  setLoading(true);
  try {
    const result = await api('/api/memory/clear', {
      method: 'POST',
      body: JSON.stringify({ agentId: currentAgent }),
    });
    setStatus(`Đã xóa ${result.cleared || 0} memory của ${name}.`, 'success');
    await loadAgentOverview();
    setLoading(false);
    await loadMemory({ quiet: true });
  } catch (error) {
    setStatus(error?.message || String(error), 'error');
  } finally {
    setLoading(false);
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && els.drawer?.classList.contains('open')) closeDrawer();
});

void loadAgentOverview();
