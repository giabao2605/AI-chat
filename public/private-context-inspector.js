function mountPrivateContextInspector() {
  if (!document.querySelector('link[href="/private-context-inspector.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/private-context-inspector.css';
    document.head.append(link);
  }

  const anchor = document.getElementById('memoryInspectorBtn') || document.getElementById('historyBtn');
  if (anchor && !document.getElementById('privateContextInspectorBtn')) {
    const button = document.createElement('button');
    button.id = 'privateContextInspectorBtn';
    button.className = 'button ghost compact-button';
    button.type = 'button';
    button.textContent = 'Private';
    anchor.insertAdjacentElement('afterend', button);
  }

  if (!document.getElementById('privateContextInspectorDrawer')) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="privateContextInspectorBackdrop" class="private-context-inspector-backdrop hidden"></div>
      <aside id="privateContextInspectorDrawer" class="private-context-inspector-drawer" aria-hidden="true">
        <div class="private-context-inspector-header">
          <div>
            <div class="eyebrow">PRIVATE CONTEXT</div>
            <h2>Luồng context riêng</h2>
            <p>State riêng của phiên hiện tại/resume. Không phải long-term memory và không tự được recall ở phiên mới.</p>
          </div>
          <button id="closePrivateContextInspectorBtn" class="icon-button" type="button" title="Đóng">×</button>
        </div>

        <div class="private-context-inspector-toolbar">
          <label class="private-context-reveal"><input id="privateContextReveal" type="checkbox" /><span>Hiện nội dung private</span></label>
          <button id="privateContextRefresh" class="button ghost" type="button">Làm mới</button>
        </div>

        <div class="private-context-inspector-body">
          <div id="privateContextSummary" class="private-context-summary">Chưa tải session.</div>

          <section class="private-context-section">
            <div class="private-context-section-title"><b>Luồng gửi</b><small>Fan-out / fan-in trong session</small></div>
            <div id="privateContextEdges" class="private-context-edges"></div>
          </section>

          <section class="private-context-section">
            <div class="private-context-section-title"><b>Theo agent</b><small>Số context đã gửi / nhận</small></div>
            <div id="privateContextAgentStats" class="private-context-agent-stats"></div>
          </section>

          <section class="private-context-section">
            <div class="private-context-section-title"><b>Timeline</b><small>Nội dung bị ẩn mặc định</small></div>
            <div id="privateContextEmpty" class="private-context-empty hidden">Phiên này chưa có private context.</div>
            <div id="privateContextTimeline" class="private-context-timeline"></div>
          </section>
        </div>
      </aside>
    `);
  }
}

mountPrivateContextInspector();

const $ = (id) => document.getElementById(id);
const els = {
  openBtn: $('privateContextInspectorBtn'),
  drawer: $('privateContextInspectorDrawer'),
  backdrop: $('privateContextInspectorBackdrop'),
  closeBtn: $('closePrivateContextInspectorBtn'),
  reveal: $('privateContextReveal'),
  refreshBtn: $('privateContextRefresh'),
  summary: $('privateContextSummary'),
  edges: $('privateContextEdges'),
  agentStats: $('privateContextAgentStats'),
  timeline: $('privateContextTimeline'),
  empty: $('privateContextEmpty'),
};

let config = null;
let lastState = null;
let loading = false;
let refreshTimer = 0;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function api(path) {
  const response = await fetch(path, { headers: { accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function ensureConfig() {
  if (!config) config = await api('/api/config');
  return config;
}

function agentMap(state) {
  const result = {};
  for (const [id, agent] of Object.entries(config?.agents || {})) {
    if (agent?.configured) result[id] = agent.name || id.toUpperCase();
  }
  for (const [id, profile] of Object.entries(state?.agentProfiles || {})) {
    if (profile?.name) result[id] = profile.name;
  }
  return result;
}

function formatTime(value) {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function aggregateEdges(entries) {
  const edges = new Map();
  for (const entry of entries) {
    const key = `${entry.senderId}->${entry.recipientId}`;
    const current = edges.get(key) || { senderId: entry.senderId, recipientId: entry.recipientId, count: 0, lastAt: '' };
    current.count += 1;
    current.lastAt = entry.createdAt || current.lastAt;
    edges.set(key, current);
  }
  return [...edges.values()].sort((a, b) => b.count - a.count || String(b.lastAt).localeCompare(String(a.lastAt)));
}

function renderEdges(entries, names) {
  const edges = aggregateEdges(entries);
  if (!edges.length) {
    els.edges.innerHTML = '<div class="private-context-muted">Chưa có luồng private.</div>';
    return;
  }
  els.edges.innerHTML = edges.map((edge) => `
    <div class="private-context-edge">
      <span class="private-context-agent-name">${escapeHtml(names[edge.senderId] || edge.senderId.toUpperCase())}</span>
      <span class="private-context-arrow">→</span>
      <span class="private-context-agent-name">${escapeHtml(names[edge.recipientId] || edge.recipientId.toUpperCase())}</span>
      <strong>${edge.count}</strong>
    </div>
  `).join('');
}

function renderAgentStats(state, entries, names) {
  const stats = state?.privateContextStats?.byAgent || {};
  const ids = Object.keys(names);
  els.agentStats.innerHTML = ids.map((id) => {
    const fallbackSent = entries.filter((entry) => entry.senderId === id).length;
    const fallbackReceived = entries.filter((entry) => entry.recipientId === id).length;
    const sent = Number(stats?.[id]?.sent ?? fallbackSent);
    const received = Number(stats?.[id]?.received ?? fallbackReceived);
    return `
      <div class="private-context-agent-card">
        <b>${escapeHtml(names[id] || id.toUpperCase())}</b>
        <span>Gửi <strong>${sent}</strong></span>
        <span>Nhận <strong>${received}</strong></span>
      </div>
    `;
  }).join('') || '<div class="private-context-muted">Chưa có agent được cấu hình.</div>';
}

function renderTimeline(entries, names) {
  const reveal = Boolean(els.reveal.checked);
  const ordered = [...entries].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  els.empty.classList.toggle('hidden', ordered.length > 0);
  els.timeline.innerHTML = ordered.map((entry) => {
    const content = String(entry.content || '');
    return `
      <article class="private-context-event">
        <div class="private-context-event-top">
          <div>
            <b>${escapeHtml(names[entry.senderId] || entry.senderId?.toUpperCase() || '?')}</b>
            <span>→</span>
            <b>${escapeHtml(names[entry.recipientId] || entry.recipientId?.toUpperCase() || '?')}</b>
          </div>
          <time>${escapeHtml(formatTime(entry.createdAt))}</time>
        </div>
        <div class="private-context-event-meta">
          <span>${content.length} ký tự</span>
          <span>id: ${escapeHtml(String(entry.id || '').slice(0, 12) || '—')}</span>
        </div>
        ${reveal
          ? `<div class="private-context-content">${escapeHtml(content)}</div>`
          : '<div class="private-context-redacted">Nội dung private đang được ẩn.</div>'}
      </article>
    `;
  }).join('');
}

function render(state) {
  lastState = state;
  const entries = Array.isArray(state?.privateContexts) ? state.privateContexts : [];
  const names = agentMap(state);
  const run = state?.runId ? String(state.runId).slice(0, 14) : 'chưa có';
  els.summary.textContent = `${entries.length} private context · run ${run} · session-only`;
  renderEdges(entries, names);
  renderAgentStats(state, entries, names);
  renderTimeline(entries, names);
}

async function loadState() {
  if (loading) return;
  loading = true;
  els.refreshBtn.disabled = true;
  try {
    await ensureConfig();
    render(await api('/api/state'));
  } catch (error) {
    els.summary.textContent = error?.message || String(error);
    els.edges.innerHTML = '';
    els.agentStats.innerHTML = '';
    els.timeline.innerHTML = '';
  } finally {
    loading = false;
    els.refreshBtn.disabled = false;
  }
}

function startAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (els.drawer.classList.contains('open')) void loadState();
  }, 2000);
}

function stopAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = 0;
}

async function openInspector() {
  els.drawer.classList.add('open');
  els.drawer.setAttribute('aria-hidden', 'false');
  els.backdrop.classList.remove('hidden');
  await loadState();
  startAutoRefresh();
}

function closeInspector() {
  els.drawer.classList.remove('open');
  els.drawer.setAttribute('aria-hidden', 'true');
  els.backdrop.classList.add('hidden');
  stopAutoRefresh();
}

els.openBtn?.addEventListener('click', () => void openInspector());
els.closeBtn?.addEventListener('click', closeInspector);
els.backdrop?.addEventListener('click', closeInspector);
els.refreshBtn?.addEventListener('click', () => void loadState());
els.reveal?.addEventListener('change', () => {
  if (lastState) render(lastState);
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && els.drawer?.classList.contains('open')) closeInspector();
});
