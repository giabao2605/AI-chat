import { ParallelBatchRoom } from './parallel-batch-room.js';

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function cleanText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function profilePrompt(profile) {
  const parts = [
    `Danh tính của bạn trong phòng này là ${profile.name}.`,
    'Hãy giữ nhất quán danh tính này trong suốt phiên.',
    'Không suy đoán hoặc khẳng định model, provider hay hạ tầng nội bộ của bản thân hoặc người khác nếu thông tin đó không được cung cấp trực tiếp trong hội thoại.',
  ];
  if (profile.role) parts.push(`Vai trò chính: ${profile.role}`);
  if (profile.persona) parts.push(`Tính cách: ${profile.persona}`);
  if (profile.speakingStyle) parts.push(`Kiểu nói: ${profile.speakingStyle}`);
  return parts.join('\n');
}

export class ProfiledRoom extends ParallelBatchRoom {
  constructor(options = {}) {
    super(options);
    this.agentConfigs = Object.fromEntries(Object.entries(this.agentConfigs).map(([id, agent]) => [id, { ...agent }]));
    this.baseAgentNames = Object.fromEntries(Object.entries(this.agentConfigs).map(([id, agent]) => [id, agent.name]));
    this.agentProfiles = {};
    this.profileTurnActive = new Set();
    this.profileOverrideSuppressed = new Set();
  }

  normalizeProfiles(input = {}) {
    const rawProfiles = input.agentProfiles && typeof input.agentProfiles === 'object' ? input.agentProfiles : {};
    const globalTemperature = clamp(input.temperature, 0, 2, 0.8);
    const globalMaxTokens = Math.floor(clamp(input.maxOutputTokens, 64, 16000, 1200));

    return Object.fromEntries(this.agentIds.map((id) => {
      const raw = rawProfiles[id] && typeof rawProfiles[id] === 'object' ? rawProfiles[id] : {};
      const legacyPersona = input?.personas?.[id] ?? input?.[`persona${id.toUpperCase()}`] ?? '';
      return [id, {
        id,
        name: cleanText(raw.name, 80) || this.baseAgentNames[id] || `Agent ${id.toUpperCase()}`,
        role: cleanText(raw.role, 1200),
        persona: cleanText(raw.persona ?? legacyPersona, 6000),
        speakingStyle: cleanText(raw.speakingStyle, 3000),
        temperature: clamp(raw.temperature, 0, 2, globalTemperature),
        maxOutputTokens: Math.floor(clamp(raw.maxOutputTokens, 64, 16000, globalMaxTokens)),
      }];
    }));
  }

  prepareProfileInput(input = {}) {
    const profiles = this.normalizeProfiles(input);
    this.agentProfiles = profiles;
    const personas = {};

    for (const id of this.agentIds) {
      const profile = profiles[id];
      this.agentConfigs[id].name = profile.name;
      personas[id] = profilePrompt(profile);
    }

    return { ...input, personas, agentProfiles: profiles };
  }

  async start(input = {}) {
    return super.start(this.prepareProfileInput(input));
  }

  async continueFromHistory(input = {}) {
    return super.continueFromHistory(this.prepareProfileInput(input));
  }

  snapshot() {
    const base = super.snapshot();
    return {
      ...base,
      agentProfiles: Object.fromEntries(Object.entries(this.agentProfiles || {}).map(([id, profile]) => [id, { ...profile }])),
    };
  }

  createProviders() {
    super.createProviders();
    for (const id of this.agentIds) {
      const provider = this.providers[id];
      if (!provider?.streamChat) continue;
      const streamChat = provider.streamChat.bind(provider);
      provider.streamChat = (options = {}) => {
        const profile = this.agentProfiles?.[id];
        const shouldOverride = profile && this.profileTurnActive.has(id) && !this.profileOverrideSuppressed.has(id);
        return streamChat(shouldOverride ? {
          ...options,
          temperature: profile.temperature,
          maxOutputTokens: profile.maxOutputTokens,
        } : options);
      };
    }
  }

  async executeAgentTurn(agentId, activeRunId = this.runId) {
    this.profileTurnActive.add(agentId);
    try {
      return await super.executeAgentTurn(agentId, activeRunId);
    } finally {
      this.profileTurnActive.delete(agentId);
    }
  }

  async maybeRefreshSummary(agentId, historySnapshot, signal) {
    this.profileOverrideSuppressed.add(agentId);
    try {
      return await super.maybeRefreshSummary(agentId, historySnapshot, signal);
    } finally {
      this.profileOverrideSuppressed.delete(agentId);
    }
  }

  async addWebResearch(agentId, messages, signal, historySnapshot) {
    this.profileOverrideSuppressed.add(agentId);
    try {
      return await super.addWebResearch(agentId, messages, signal, historySnapshot);
    } finally {
      this.profileOverrideSuppressed.delete(agentId);
    }
  }
}
