import { resolveAgentDisplayName } from './model-name-utils.js';

export const AGENT_PROFILE_STORAGE_KEY = 'ai-chat-agent-profiles-v1';

const $ = (id) => document.getElementById(id);
let cachedConfig = null;
let syncQueued = false;

function safeJson(raw, fallback = {}) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function clean(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function storedProfiles() {
  return safeJson(localStorage.getItem(AGENT_PROFILE_STORAGE_KEY), {});
}

function fieldValue(id) {
  const field = $(id);
  return field ? field.value : undefined;
}

export function readAgentProfiles() {
  const stored = storedProfiles();
  const ids = cachedConfig?.agentSlots || ['a', 'b', 'c', 'd'];
  const defaults = cachedConfig?.defaults || {};
  const result = {};

  for (const id of ids) {
    const saved = stored[id] || {};
    const agent = cachedConfig?.agents?.[id] || {};
    const resolvedSavedName = resolveAgentDisplayName(agent, saved.name);
    const name = fieldValue(`profile-${id}-name`);
    const role = fieldValue(`profile-${id}-role`);
    const persona = fieldValue(`profile-${id}-persona`);
    const speakingStyle = fieldValue(`profile-${id}-style`);
    const temperature = fieldValue(`profile-${id}-temperature`);
    const maxOutputTokens = fieldValue(`profile-${id}-max-tokens`);
    if (!cachedConfig?.agents?.[id] && !saved.name && name === undefined) continue;

    result[id] = {
      name: clean(name ?? resolvedSavedName ?? agent.name ?? `Agent ${id.toUpperCase()}`, 80),
      role: clean(role ?? saved.role ?? '', 1200),
      persona: clean(persona ?? saved.persona ?? '', 6000),
      speakingStyle: clean(speakingStyle ?? saved.speakingStyle ?? '', 3000),
      temperature: clamp(temperature ?? saved.temperature, 0, 2, Number(defaults.temperature ?? 0.8)),
      maxOutputTokens: Math.floor(clamp(maxOutputTokens ?? saved.maxOutputTokens, 64, 16000, Number(defaults.maxOutputTokens ?? 1200))),
    };
  }
  return result;
}

function persistProfiles() {
  try { localStorage.setItem(AGENT_PROFILE_STORAGE_KEY, JSON.stringify(readAgentProfiles())); } catch {}
  syncSurfaceLabels();
}

function createStyles() {
  if ($('agentProfileStyles')) return;
  const style = document.createElement('style');
  style.id = 'agentProfileStyles';
  style.textContent = `
    .agent-profile-shell{display:grid;gap:10px;margin:12px 0 14px}.agent-profile-card{border:1px solid rgba(127,127,127,.16);border-radius:12px;background:rgba(127,127,127,.04);overflow:hidden}.agent-profile-card>summary{display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;padding:12px 13px;font-weight:700}.agent-profile-card>summary::-webkit-details-marker{display:none}.agent-profile-summary-meta{font-size:11px;font-weight:500;opacity:.58}.agent-profile-body{display:grid;gap:10px;padding:0 12px 12px}.agent-profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.agent-profile-card .field{margin:0}.agent-profile-card textarea{resize:vertical}.agent-profile-actions{display:flex;justify-content:flex-end;margin-top:2px}.agent-profile-reset{border:0;background:transparent;color:inherit;opacity:.58;cursor:pointer;font:inherit;font-size:12px;padding:5px 8px;border-radius:7px}.agent-profile-reset:hover{opacity:1;background:rgba(127,127,127,.1)}.agent-profile-hidden{display:none!important}@media(max-width:760px){.agent-profile-grid{grid-template-columns:1fr}}
  `;
  document.head.append(style);
}

function profileDefaults(id, config, saved) {
  const legacyPersona = $(`persona${id.toUpperCase()}`)?.value || '';
  const resolvedName = resolveAgentDisplayName(config.agents[id], saved.name);
  return {
    name: resolvedName || config.agents[id]?.name || `Agent ${id.toUpperCase()}`,
    role: saved.role || '',
    persona: saved.persona ?? legacyPersona,
    speakingStyle: saved.speakingStyle || '',
    temperature: saved.temperature ?? config.defaults?.temperature ?? 0.8,
    maxOutputTokens: saved.maxOutputTokens ?? config.defaults?.maxOutputTokens ?? 1200,
  };
}

function field(label, control) {
  const wrapper = document.createElement('label');
  wrapper.className = 'field';
  const span = document.createElement('span');
  span.textContent = label;
  wrapper.append(span, control);
  return wrapper;
}

function input(type, id, value, extra = {}) {
  const el = document.createElement('input');
  el.type = type;
  el.id = id;
  el.value = value;
  Object.assign(el, extra);
  return el;
}

function textarea(id, value, rows = 3, placeholder = '') {
  const el = document.createElement('textarea');
  el.id = id;
  el.rows = rows;
  el.value = value;
  el.placeholder = placeholder;
  return el;
}

function profileCard(id, config, saved) {
  const defaults = profileDefaults(id, config, saved);
  const details = document.createElement('details');
  details.className = 'agent-profile-card';
  details.open = id === 'a';
  details.dataset.agentId = id;

  const summary = document.createElement('summary');
  const title = document.createElement('span');
  title.id = `profile-${id}-summary-name`;
  title.textContent = defaults.name;
  const meta = document.createElement('span');
  meta.className = 'agent-profile-summary-meta';
  meta.textContent = `Agent ${id.toUpperCase()}`;
  summary.append(title, meta);

  const body = document.createElement('div');
  body.className = 'agent-profile-body';
  const identityGrid = document.createElement('div');
  identityGrid.className = 'agent-profile-grid';
  identityGrid.append(
    field('Name', input('text', `profile-${id}-name`, defaults.name, { maxLength: 80 })),
    field('Role', input('text', `profile-${id}-role`, defaults.role, { maxLength: 1200, placeholder: 'Ví dụ: phản biện, tổng hợp, sáng tạo...' })),
  );
  const behaviorGrid = document.createElement('div');
  behaviorGrid.className = 'agent-profile-grid';
  behaviorGrid.append(
    field('Tính cách', textarea(`profile-${id}-persona`, defaults.persona, 4, 'Thói quen suy nghĩ, ưu tiên, thái độ...')),
    field('Kiểu nói', textarea(`profile-${id}-style`, defaults.speakingStyle, 4, 'Ví dụ: ngắn gọn, hơi mỉa, thiên về ví dụ...')),
  );
  const generationGrid = document.createElement('div');
  generationGrid.className = 'agent-profile-grid';
  generationGrid.append(
    field('Temperature', input('number', `profile-${id}-temperature`, defaults.temperature, { min: '0', max: '2', step: '0.1' })),
    field('Max token/lượt', input('number', `profile-${id}-max-tokens`, defaults.maxOutputTokens, { min: '64', max: '16000', step: '1' })),
  );
  const actions = document.createElement('div');
  actions.className = 'agent-profile-actions';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'agent-profile-reset';
  reset.textContent = 'Reset profile';
  reset.addEventListener('click', () => {
    const base = profileDefaults(id, config, {});
    $(`profile-${id}-name`).value = base.name;
    $(`profile-${id}-role`).value = '';
    $(`profile-${id}-persona`).value = '';
    $(`profile-${id}-style`).value = '';
    $(`profile-${id}-temperature`).value = config.defaults?.temperature ?? 0.8;
    $(`profile-${id}-max-tokens`).value = config.defaults?.maxOutputTokens ?? 1200;
    persistProfiles();
  });
  actions.append(reset);
  body.append(identityGrid, behaviorGrid, generationGrid, actions);
  details.append(summary, body);

  for (const control of body.querySelectorAll('input,textarea')) {
    control.addEventListener('input', () => {
      if (control.id === `profile-${id}-name`) title.textContent = control.value.trim() || `Agent ${id.toUpperCase()}`;
      persistProfiles();
    });
  }
  return details;
}

function hideLegacyControls() {
  for (const id of ['a', 'b', 'c', 'd']) {
    const legacy = $(`persona${id.toUpperCase()}`);
    legacy?.closest('.field')?.classList.add('agent-profile-hidden');
  }
  $('temperature')?.closest('.field')?.classList.add('agent-profile-hidden');
  $('maxOutputTokens')?.closest('.field')?.classList.add('agent-profile-hidden');
}

function setTextIfChanged(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function syncSurfaceLabels() {
  const profiles = readAgentProfiles();
  for (const [id, profile] of Object.entries(profiles)) {
    const upper = id.toUpperCase();
    setTextIfChanged($(`profile-${id}-summary-name`), profile.name || `Agent ${upper}`);
    setTextIfChanged($(`agent${upper}Name`), profile.name || `Agent ${upper}`);
    const total = $(`agent${upper}Total`);
    const card = total?.closest('.mini-stat');
    if (card) {
      setTextIfChanged(card.querySelector(':scope > span'), profile.name || `Agent ${upper}`);
      setTextIfChanged(card.querySelector('small > span'), profile.role || 'profile riêng');
    }
    const option = [...($('startSpeaker')?.options || [])].find((item) => item.value === id);
    setTextIfChanged(option, profile.name || `Agent ${upper}`);
  }
}

function syncLegacyPersona(id) {
  const legacy = $(`persona${id.toUpperCase()}`);
  const profileField = $(`profile-${id}-persona`);
  if (!legacy || !profileField) return;
  legacy.addEventListener('input', () => {
    if (profileField.value !== legacy.value) {
      profileField.value = legacy.value;
      persistProfiles();
    }
  });
  legacy.addEventListener('change', () => {
    if (profileField.value !== legacy.value) {
      profileField.value = legacy.value;
      persistProfiles();
    }
  });
}

async function initAgentProfiles() {
  createStyles();
  const promptPanel = $('promptPanel');
  if (!promptPanel || $('agentProfilesShell')) return;
  try {
    const response = await fetch('/api/config', { cache: 'no-store' });
    cachedConfig = await response.json();
  } catch {
    return;
  }

  const saved = storedProfiles();
  const shell = document.createElement('div');
  shell.id = 'agentProfilesShell';
  shell.className = 'agent-profile-shell';
  const heading = document.createElement('div');
  heading.innerHTML = '<strong>Agent Profiles</strong>';
  shell.append(heading);
  for (const id of cachedConfig.agentSlots || ['a', 'b', 'c', 'd']) {
    const agent = cachedConfig.agents?.[id];
    if (!agent?.configured) continue;
    shell.append(profileCard(id, cachedConfig, saved[id] || {}));
  }

  const buttons = promptPanel.querySelector('.two-cols');
  promptPanel.insertBefore(shell, buttons || null);
  hideLegacyControls();
  for (const id of cachedConfig.agentSlots || []) syncLegacyPersona(id);
  persistProfiles();
  syncSurfaceLabels();

  const observer = new MutationObserver(() => {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      hideLegacyControls();
      syncSurfaceLabels();
    });
  });
  observer.observe(document.querySelector('.control-panel') || document.body, { childList: true, subtree: true });
}

window.__AI_AGENT_PROFILES__ = { read: readAgentProfiles, storageKey: AGENT_PROFILE_STORAGE_KEY };
queueMicrotask(() => void initAgentProfiles());
