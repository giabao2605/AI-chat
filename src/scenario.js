function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function hashSeed(value) {
  const text = String(value ?? 'scenario-default-seed');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createSeededRng(seed = 'scenario-default-seed') {
  let state = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled(values, rng = Math.random) {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const selected = Math.floor(rng() * (index + 1));
    [next[index], next[selected]] = [next[selected], next[index]];
  }
  return next;
}

function assertDefinition(definition) {
  if (!definition || typeof definition !== 'object') throw new Error('Scenario definition is required.');
  for (const field of ['id', 'version']) {
    if (!String(definition[field] || '').trim()) throw new Error(`Scenario definition thiếu ${field}.`);
  }
  for (const method of [
    'initialize', 'publicState', 'privateContextFor', 'legalActionsFor', 'eligibleSpeakers',
    'applyAction', 'onPublicMessage', 'maybeAdvancePhase', 'isComplete', 'result',
  ]) {
    if (typeof definition[method] !== 'function') throw new Error(`Scenario definition thiếu method ${method}().`);
  }
}

function cleanAgentIds(values = []) {
  const ids = [...new Set(values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))];
  if (!ids.length) throw new Error('Scenario cần ít nhất một agent.');
  return ids;
}

function actionMatches(legal, action) {
  if (String(legal?.type || '') !== String(action?.type || '')) return false;
  const targets = Array.isArray(legal?.targets) ? legal.targets.map(String) : [];
  if (!targets.length) return action?.target == null || String(action.target || '') === '';
  return targets.includes(String(action?.target || ''));
}

export class ScenarioController {
  constructor({ definition, agentIds, options = {}, rng = null } = {}) {
    assertDefinition(definition);
    this.definition = definition;
    this.agentIds = cleanAgentIds(agentIds || []);
    this.options = options && typeof options === 'object' ? clone(options) : {};
    const minimum = Math.max(1, Number(definition.minimumPlayers) || 1);
    const maximum = Math.max(minimum, Number(definition.maximumPlayers) || Number.MAX_SAFE_INTEGER);
    if (this.agentIds.length < minimum || this.agentIds.length > maximum) {
      throw new Error(`Scenario ${definition.id} hỗ trợ ${minimum}-${maximum} agent; hiện có ${this.agentIds.length}.`);
    }
    this.rng = typeof rng === 'function' ? rng : createSeededRng(this.options.seed ?? `${definition.id}:${this.agentIds.join(',')}`);
    this.state = definition.initialize([...this.agentIds], clone(this.options), this.rng);
    if (!this.state || typeof this.state !== 'object') throw new Error('Scenario initialize() phải trả về state object.');
    this.stateVersion = 1;
    this.maybeAdvancePhase();
  }

  get id() { return this.definition.id; }
  get version() { return this.definition.version; }
  get phase() { return String(this.state?.phase || ''); }

  publicState() {
    return clone(this.definition.publicState(this.state));
  }

  publicSnapshot() {
    return {
      id: this.id,
      version: this.version,
      stateVersion: this.stateVersion,
      phase: this.phase,
      active: !this.isComplete(),
      resumeSupported: false,
      state: this.publicState(),
    };
  }

  privateContextFor(agentId) {
    const id = String(agentId || '').toLowerCase();
    if (!this.agentIds.includes(id)) return '';
    return String(this.definition.privateContextFor(this.state, id) || '').trim();
  }

  legalActionsFor(agentId) {
    const id = String(agentId || '').toLowerCase();
    if (!this.agentIds.includes(id)) return [];
    const actions = this.definition.legalActionsFor(this.state, id);
    return Array.isArray(actions) ? clone(actions) : [];
  }

  eligibleSpeakers() {
    const raw = this.definition.eligibleSpeakers(this.state);
    const allowed = new Set(this.agentIds);
    return [...new Set((Array.isArray(raw) ? raw : []).map((id) => String(id || '').toLowerCase()))]
      .filter((id) => allowed.has(id));
  }

  applyAction(agentId, action) {
    const id = String(agentId || '').toLowerCase();
    if (!this.agentIds.includes(id)) throw new Error('Scenario action từ agent không hợp lệ.');
    const normalized = {
      type: String(action?.type || '').trim(),
      ...(action?.target != null && String(action.target).trim() ? { target: String(action.target).trim().toLowerCase() } : {}),
    };
    const legal = this.legalActionsFor(id);
    if (!legal.some((candidate) => actionMatches(candidate, normalized))) {
      const error = new Error('Scenario action không hợp lệ ở phase hiện tại.');
      error.code = 'SCENARIO_ACTION_INVALID';
      throw error;
    }
    const result = this.definition.applyAction(this.state, id, normalized);
    this.stateVersion += 1;
    this.maybeAdvancePhase();
    return clone(result);
  }

  onPublicMessage(agentId, message) {
    const id = String(agentId || '').toLowerCase();
    if (!this.agentIds.includes(id)) return false;
    const changed = this.definition.onPublicMessage(this.state, id, clone(message || {}));
    if (changed !== false) this.stateVersion += 1;
    this.maybeAdvancePhase();
    return changed !== false;
  }

  maybeAdvancePhase() {
    for (let guard = 0; guard < 32; guard += 1) {
      if (this.definition.isComplete(this.state)) break;
      const changed = this.definition.maybeAdvancePhase(this.state);
      if (!changed) break;
      this.stateVersion += 1;
    }
    return this.phase;
  }

  isComplete() {
    return Boolean(this.definition.isComplete(this.state));
  }

  result() {
    return clone(this.definition.result(this.state));
  }
}

export const SCENARIO_ACTION_TOOL_NAME = 'scenario_action';

export function buildScenarioActionTool(controller, agentId) {
  const legal = controller?.legalActionsFor?.(agentId) || [];
  if (!legal.length) return null;
  const actionTypes = [...new Set(legal.map((action) => String(action?.type || '')).filter(Boolean))];
  const targets = [...new Set(legal.flatMap((action) => Array.isArray(action?.targets) ? action.targets : []).map(String))];
  const actionSummary = legal.map((action) => {
    const targetText = Array.isArray(action.targets) && action.targets.length ? ` -> [${action.targets.join(', ')}]` : '';
    return `${action.type}${targetText}`;
  }).join('; ');
  return {
    type: 'function',
    function: {
      name: SCENARIO_ACTION_TOOL_NAME,
      description: `Thực hiện đúng một hành động hợp lệ trong scenario hiện tại. Backend sẽ kiểm tra lại action và target. Hành động hợp lệ: ${actionSummary}`,
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: actionTypes, description: 'Loại hành động scenario.' },
          ...(targets.length ? { target: { type: 'string', enum: targets, description: 'Agent mục tiêu nếu action yêu cầu target.' } } : {}),
        },
        required: ['action'],
        additionalProperties: false,
      },
    },
  };
}

export function parseScenarioActionToolCall(call) {
  if (String(call?.function?.name || '') !== SCENARIO_ACTION_TOOL_NAME) return null;
  let args;
  try {
    args = JSON.parse(String(call?.function?.arguments || '{}'));
  } catch {
    return { action: null, error: 'Scenario action có JSON arguments không hợp lệ.' };
  }
  const type = String(args?.action || '').trim();
  const target = String(args?.target || '').trim().toLowerCase();
  if (!type) return { action: null, error: 'Scenario action thiếu action.' };
  return { action: { type, ...(target ? { target } : {}) }, error: '' };
}

export function scenarioContextBlocks(controller, agentId) {
  if (!controller) return { publicBlock: '', privateBlock: '', privateChars: 0 };
  const publicBlock = `<scenario_public_state>\n${JSON.stringify(controller.publicState())}\n</scenario_public_state>`;
  const privateText = controller.privateContextFor(agentId);
  const privateBlock = privateText ? `<scenario_private_state>\n${privateText}\n</scenario_private_state>` : '';
  return { publicBlock, privateBlock, privateChars: privateText.length };
}
