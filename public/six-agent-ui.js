const EXTRA_AGENT_IDS = ['e', 'f'];

function injectStylesheet() {
  if (document.querySelector('link[data-six-agent-ui]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/six-agent-ui.css';
  link.dataset.sixAgentUi = '1';
  document.head.append(link);
}

function createStatCard(id, agent) {
  const upper = id.toUpperCase();
  const card = document.createElement('div');
  card.className = `mini-stat agent-${id}-mini`;
  card.title = `Token Agent ${upper}`;
  card.innerHTML = `<span>${agent.name || `Agent ${upper}`}</span><strong id="agent${upper}Total">0</strong><small><span>${agent.model || '-'}</span> · In <b id="agent${upper}Input">0</b> / Out <b id="agent${upper}Output">0</b></small><i id="agent${upper}Estimate"></i>`;
  return card;
}

function ensureStartSpeakerOption(id, agent) {
  const select = document.getElementById('startSpeaker');
  if (!select || [...select.options].some((option) => option.value === id)) return;
  const option = document.createElement('option');
  option.value = id;
  option.textContent = agent.name || `Agent ${id.toUpperCase()}`;
  select.append(option);
}

function ensureStatCard(id, agent) {
  const upper = id.toUpperCase();
  if (document.getElementById(`agent${upper}Total`)) return;
  const stats = document.querySelector('.compact-stats');
  if (!stats) return;
  const roomMini = stats.querySelector('.room-mini');
  stats.insertBefore(createStatCard(id, agent), roomMini || null);
}

async function mount() {
  injectStylesheet();
  let config;
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    if (!response.ok) return;
    config = await response.json();
  } catch {
    return;
  }

  for (const id of EXTRA_AGENT_IDS) {
    const agent = config?.agents?.[id];
    if (!agent?.configured) continue;
    ensureStatCard(id, agent);
    ensureStartSpeakerOption(id, agent);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void mount(), { once: true });
else void mount();

export { EXTRA_AGENT_IDS, createStatCard };
