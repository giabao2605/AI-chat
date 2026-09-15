function mountInspector() {
  if (!document.querySelector('link[href="/memory-inspector.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/memory-inspector.css';
    document.head.append(link);
  }

  const historyBtn = document.getElementById('historyBtn');
  if (historyBtn && !document.getElementById('memoryInspectorBtn')) {
    const button = document.createElement('button');
    button.id = 'memoryInspectorBtn';
    button.className = 'button ghost compact-button';
    button.type = 'button';
    button.textContent = 'Memory';
    historyBtn.insertAdjacentElement('afterend', button);
  }

  if (!document.getElementById('memoryInspectorDrawer')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="memoryInspectorBackdrop" class="memory-inspector-backdrop hidden"></div>
      <aside id="memoryInspectorDrawer" class="memory-inspector-drawer" aria-hidden="true">
        <div class="memory-inspector-header">
          <div>
            <div class="eyebrow">MEMORY INSPECTOR</div>
            <h2>Ký ức dài hạn</h2>
            <p>Chỉ hiển thị memory được chọn lọc để dùng xuyên phiên. Private Context của phiên hiện tại nằm ở inspector riêng.</p>
          </div>
          <button id="closeMemoryInspectorBtn" class="icon-button" type="button" title="Đóng">×</button>
        </div>
        <div class="memory-inspector-toolbar">
          <label><span>Agent</span><select id="memoryInspectorAgent"></select></label>
          <label><span>Preview query</span><input id="memoryInspectorQuery" type="search" placeholder="Ví dụ: mày nhớ game Ma Sói lần trước không?" /></label>
          <div class="memory-inspector-toolbar-row">
            <label class="memory-inspector-check"><input id="memoryInspectorInactive" type="checkbox" /><span>Hiện memory inactive</span></label>
            <div class="memory-inspector-actions">
              <button id="memoryInspectorRefresh" class="button ghost" type="button">Làm mới</button>
              <button id="memoryInspectorClearAgent" class="button danger" type="button">Quên toàn bộ agent</button>
            </div>
          </div>
        </div>
        <div class="memory-inspector-body">
          <div id="memoryInspectorSummary" class="memory-inspector-summary">Chưa tải memory.</div>
          <div id="memoryInspectorEmpty" class="memory-inspector-empty hidden">Agent này chưa có long-term memory phù hợp với bộ lọc hiện tại.</div>
          <div id="memoryInspectorList" class="memory-inspector-list"></div>
        </div>
      </aside>
    `);
  }
}

mountInspector();

const $ = (id) => document.getElementById(id);

const els = {
  openBtn: $('memoryInspectorBtn'),
  drawer: $('memoryInspectorDrawer'),
  backdrop: $('memoryInspectorBackdrop'),
  closeBtn: $('closeMemoryInspectorBtn'),
  agentSelect: $('memoryInspectorAgent'),
  query: $('memoryInspectorQuery'),
  includeInactive: $('memoryInspectorInactive'),
  refreshBtn: $('memoryInspectorRefresh'),
  clearAgentBtn: $('memoryInspectorClearAgent'),
  list: $('memoryInspectorList'),
  summary: $('memoryInspectorSummary'),
  empty: $('memoryInspectorEmpty'),
};

let config = null;
let loading = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

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
  if (!Number.isFinite(number)) return '—';
  return `${Math.round(number * 100)}%`;
}

function memoryTypeLabel(type) {
  return ({
    semantic: 'Semantic',
    episodic: 'Episode',
    belief: 'Belief',
    relationship: 'Relationship',
    procedural: 'Procedural',
  })[type] || type || 'Memory';
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

async function ensureConfig() {
  if (config) return config;
  config = await api('/api/config');
  return config;
}

function configuredAgents() {
  return Object.entries(config?.agents || {})
    .filter(([, agent]) => agent?.configured)
    .map(([id, agent]) => ({ id, name: agent.name || id.toUpperCase() }));
}

function populateAgents() {
  const previous = els.agentSelect.value;
  els.agentSelect.innerHTML = '';
  for (const agent of configuredAgents()) {
    const option = document.createElement('option');
    option.value = agent.id;
    option.textContent = agent.name;
    els.agentSelect.append(option);
  }
  if ([...els.agentSelect.options].some((option) => option.value === previous)) els.agentSelect.value = previous;
}

function cardHtml(memory) {
  const activation = memory.queryProvided
    ? (memory.wouldRecall
      ? '<span class="memory-badge recall">Sẽ recall</span>'
      : '<span class="memory-badge muted">Không recall</span>')
    : '<span class="memory-badge muted">Chưa preview</span>';
  const inactive = memory.active === false ? '<span class="memory-badge inactive">Inactive</span>' : '';
  const forgotten = memory.runForgotten ? '<span class="memory-badge inactive">Run đã quên</span>' : '';
  const run = memory.runId ? `<span title="Run nguồn">run: ${escapeHtml(memory.runId)}</span>` : '<span>run: —</span>';
  const key = memory.key ? `<span title="Stable key">key: ${escapeHtml(memory.key)}</span>` : '';
  const relevanceRow = memory.queryProvided
    ? `<span title="Độ liên quan với query inspector">relevance: ${percent(memory.relevance)} · shared: ${Number(memory.sharedTokens || 0)}</span>`
    : '<span>relevance: nhập query để preview</span>';

  return `
    <article class="memory-card ${memory.active === false ? 'is-inactive' : ''}" data-memory-id="${escapeHtml(memory.id)}">
      <div class="memory-card-top">
        <div class="memory-badges">
          <span class="memory-badge type-${escapeHtml(memory.type)}">${escapeHtml(memoryTypeLabel(memory.type))}</span>
          ${activation}
          ${inactive}
          ${forgotten}
        </div>
        ${memory.active === false ? '' : `<button class="memory-forget-button" type="button" data-forget-memory="${escapeHtml(memory.id)}">Quên</button>`}
      </div>
      <div class="memory-content">${escapeHtml(memory.content)}</div>
      <div class="memory-meta">
        <span>importance: ${percent(memory.importance)}</span>
        <span>confidence: ${percent(memory.confidence)}</span>
        ${relevanceRow}
      </div>
      <div class="memory-meta secondary">
        ${run}
        ${key}
        <span>updated: ${escapeHtml(formatDate(memory.updatedAt))}</span>
        <span>used: ${Number(memory.accessCount || 0)}</span>
      </div>
    </article>
  `;
}

function render(data) {
  // Legacy builds used to auto-copy every private delivery into SQLite as type=private.
  // Those rows are no longer part of long-term memory and stay hidden here even when
  // inactive audit rows are requested. Private Context has its own inspector.
  const memories = (Array.isArray(data.memories) ? data.memories : []).filter((item) => item.type !== 'private');
  const active = memories.filter((item) => item.active !== false).length;
  const recall = memories.filter((item) => item.wouldRecall).length;
  els.summary.textContent = `${memories.length} long-term memory · ${active} active${data.query ? ` · ${recall} sẽ recall` : ''}`;
  els.empty.classList.toggle('hidden', memories.length > 0);
  els.list.innerHTML = memories.map(cardHtml).join('');
}

async function loadMemories() {
  if (loading) return;
  const agentId = els.agentSelect.value;
  if (!agentId) return;
  loading = true;
  els.refreshBtn.disabled = true;
  els.summary.textContent = 'Đang đọc long-term memory…';
  try {
    const params = new URLSearchParams({
      agent: agentId,
      includeInactive: els.includeInactive.checked ? '1' : '0',
    });
    const query = els.query.value.trim();
    if (query) params.set('query', query);
    render(await api(`/api/memory/inspect?${params.toString()}`));
  } catch (error) {
    els.summary.textContent = error?.message || String(error);
    els.list.innerHTML = '';
    els.empty.classList.remove('hidden');
  } finally {
    loading = false;
    els.refreshBtn.disabled = false;
  }
}

async function openInspector() {
  await ensureConfig();
  populateAgents();
  els.drawer.classList.add('open');
  els.drawer.setAttribute('aria-hidden', 'false');
  els.backdrop.classList.remove('hidden');
  await loadMemories();
}

function closeInspector() {
  els.drawer.classList.remove('open');
  els.drawer.setAttribute('aria-hidden', 'true');
  els.backdrop.classList.add('hidden');
}

async function forgetMemory(id) {
  const agentId = els.agentSelect.value;
  if (!agentId || !id) return;
  await api('/api/memory/forget', {
    method: 'POST',
    body: JSON.stringify({ agentId, memoryId: id }),
  });
  await loadMemories();
}

async function clearAgent() {
  const agentId = els.agentSelect.value;
  const name = els.agentSelect.selectedOptions[0]?.textContent || agentId;
  if (!agentId) return;
  if (!window.confirm(`Quên toàn bộ active long-term memory của ${name}? Hành động này không xóa lịch sử chat hoặc Private Context của phiên.`)) return;
  await api('/api/memory/clear-agent', {
    method: 'POST',
    body: JSON.stringify({ agentId }),
  });
  await loadMemories();
}

let queryTimer = 0;

els.openBtn?.addEventListener('click', () => void openInspector());
els.closeBtn?.addEventListener('click', closeInspector);
els.backdrop?.addEventListener('click', closeInspector);
els.agentSelect?.addEventListener('change', () => void loadMemories());
els.includeInactive?.addEventListener('change', () => void loadMemories());
els.refreshBtn?.addEventListener('click', () => void loadMemories());
els.clearAgentBtn?.addEventListener('click', () => void clearAgent());
els.query?.addEventListener('input', () => {
  clearTimeout(queryTimer);
  queryTimer = setTimeout(() => void loadMemories(), 250);
});
els.list?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-forget-memory]');
  if (button) void forgetMemory(button.dataset.forgetMemory);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && els.drawer?.classList.contains('open')) closeInspector();
});
