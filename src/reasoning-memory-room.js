import { randomUUID } from 'node:crypto';
import { AgentExecutor } from './agent-executor.js';
import { MemoryProfiledRoom } from './memory-profiled-room.js';
import { detectConversationLoop } from './multi-agent-room.js';
import { finalizeProviderInputProfile, profileProviderInput } from './request-metrics.js';

const REASONING_MODES = new Set(['auto', 'low', 'medium', 'high', 'xhigh', 'max']);
const MANUAL_REASONING_MODES = ['low', 'medium', 'high', 'xhigh', 'max'];
const TERMINAL_STATUSES = new Set(['stopped', 'idle', 'error', 'completed']);

function normalizeReasoningMode(value, fallback = 'auto') {
  const mode = String(value || '').trim().toLowerCase();
  return REASONING_MODES.has(mode) ? mode : fallback;
}

function providerCapabilityKey(config = {}) {
  return `${String(config.baseUrl || '').trim().replace(/\/+$/, '').toLowerCase()}::${String(config.model || '').trim().toLowerCase()}`;
}

function isOfficialOpenAI(config = {}) {
  try {
    const base = String(config.baseUrl || '').trim().replace(/\/+$/, '');
    const url = new URL(base);
    return url.hostname.toLowerCase() === 'api.openai.com';
  } catch {
    return false;
  }
}

function isOfficialGpt56(config = {}) {
  return isOfficialOpenAI(config) && /^gpt-5\.6(?:-|$)/i.test(String(config.model || '').trim());
}

function unsupportedReasoningError(mode, details = '') {
  const suffix = details ? ` ${details}` : '';
  const error = new Error(`Provider không hỗ trợ mức suy luận '${mode}' theo chế độ strict.${suffix}`);
  error.code = 'REASONING_EFFORT_UNSUPPORTED';
  return error;
}

export class ReasoningMemoryProfiledRoom extends MemoryProfiledRoom {
  constructor(options = {}) {
    super(options);
    this.agentExecutor = new AgentExecutor();
    this.reasoningMode = 'auto';
    this.reasoningProbeCache = new Map();
    const contextConfig = options.contextConfig && typeof options.contextConfig === 'object' ? options.contextConfig : {};
    this.contextBudgetConfig = {
      budgetTokens: Math.max(0, Number(contextConfig.inputBudgetTokens) || 0),
      safetyMargin: Number.isFinite(Number(contextConfig.budgetSafetyMargin)) ? Number(contextConfig.budgetSafetyMargin) : 0.12,
      imageTokenReserve: Math.max(0, Number(contextConfig.imageTokenReserve) || 1500),
      minRecentMessages: Math.max(1, Number(contextConfig.minRecentMessages) || 4),
      agentBudgets: contextConfig.agentBudgets && typeof contextConfig.agentBudgets === 'object' ? { ...contextConfig.agentBudgets } : {},
    };
    this.contextAssembler.setBudgetConfig(this.contextBudgetConfig);

    const baseProviderFactory = this.providerFactory;
    this.reasoningBaseProviderFactory = baseProviderFactory;
    this.providerFactory = (config) => {
      const provider = baseProviderFactory(config);
      if (!provider?.streamChat) return provider;

      const streamChat = provider.streamChat.bind(provider);
      const agentId = String(config?.id || '').trim().toLowerCase();
      provider.streamChat = async (request = {}) => {
        const manualMode = this.reasoningMode !== 'auto' ? this.reasoningMode : '';
        const isMainAgentProvider = this.providers?.[agentId] === provider;
        const isMainAgentTurn = isMainAgentProvider
          && this.profileTurnActive?.has(agentId)
          && !this.profileOverrideSuppressed?.has(agentId);
        let effectiveRequest = manualMode && isMainAgentTurn ? {
          ...request,
          reasoningEffort: manualMode,
          adaptiveReasoning: false,
        } : request;

        let contextBudget = null;
        if (isMainAgentTurn) {
          const budgeted = this.contextAssembler.applyBudget(effectiveRequest.messages, effectiveRequest.tools, { agentId });
          effectiveRequest = { ...effectiveRequest, messages: budgeted.messages };
          contextBudget = budgeted.debug;
        }

        const inputProfile = profileProviderInput(effectiveRequest.messages, effectiveRequest.tools);
        const result = await streamChat(effectiveRequest);
        const profiledResult = {
          ...result,
          diagnostics: {
            ...(result?.diagnostics || {}),
            inputProfile: finalizeProviderInputProfile(inputProfile, result?.usage),
            ...(contextBudget ? { contextBudget } : {}),
          },
        };

        if (manualMode && isMainAgentTurn && profiledResult?.diagnostics?.reasoningEffort !== manualMode) {
          throw unsupportedReasoningError(
            manualMode,
            'Provider đã trả response nhưng không xác nhận request cuối cùng dùng đúng reasoning_effort đã chọn.',
          );
        }
        return profiledResult;
      };
      return provider;
    };
  }

  async runAgentTurn(agentId, activeRunId = this.runId, controller = new AbortController()) {
    const agent = this.agentConfigs[agentId];
    const messageId = randomUUID();
    const startedAt = Date.now();
    const historySnapshot = this.history.slice();
    const summaryDebug = await this.maybeRefreshSummary(agentId, historySnapshot, controller.signal);
    const recentStart = Math.max(this.summaryCoveredIndex, historySnapshot.length - this.contextConfig.recentMessages);
    const recentRaw = historySnapshot.slice(recentStart);
    const recentHistory = await this.historyForModel(recentRaw);
    const loopGuard = detectConversationLoop(historySnapshot, this.contextConfig.loopThreshold, this.agentIds);
    const messages = this.contextAssembler.buildAgentMessages({
      agentId,
      agentName: agent.name,
      participants: this.agentIds.map((id) => this.agentConfigs[id]),
      topic: this.topic,
      recentHistory,
      sharedPrompt: this.settings.sharedPrompt,
      personaPrompt: this.settings.personas[agentId],
      summary: this.contextSummary,
      loopGuard,
      imageToolAvailable: this.imageToolAvailable(),
      conversationMode: this.settings.conversationMode,
    });

    let research = { sources: [], debug: { searched: false, ms: 0 } };
    try {
      research = await this.addWebResearch(agentId, messages, controller.signal, historySnapshot);
    } catch (error) {
      if (error?.name === 'AbortError' || activeRunId !== this.runId) return null;
      throw error;
    }
    if (activeRunId !== this.runId || TERMINAL_STATUSES.has(this.status)) return null;

    const execution = await this.agentExecutor.execute({
      agentId,
      agentName: agent.name,
      messageId,
      provider: this.providers[agentId],
      messages,
      temperature: this.settings.temperature,
      maxOutputTokens: this.settings.maxOutputTokens,
      signal: controller.signal,
      isActive: () => activeRunId === this.runId && !TERMINAL_STATUSES.has(this.status),
      emit: (eventName, payload) => this.emit(eventName, payload),
      imageTool: this.imageToolAvailable() ? this.imageTool : null,
      maxImageCalls: this.maxImageToolCallsPerTurn,
      recordImageToolEntry: ({ prompt, attachment, errorMessage }) => this.addImageToolHistoryEntry(agentId, prompt, attachment, errorMessage),
      appendImageToolEntry: (targetMessages, entry) => this.appendToolEntryToMessages(targetMessages, entry, agentId),
      onVisionFallback: () => {
        if (this.visionFallbackWarned[agentId]) return;
        this.visionFallbackWarned[agentId] = true;
        this.emit('meta', { text: `${agent.name}: provider không nhận image input; đã fallback sang text.` });
      },
      onToolFallback: () => {
        if (this.toolFallbackWarned[agentId]) return;
        this.toolFallbackWarned[agentId] = true;
        this.emit('meta', { text: `${agent.name}: provider không nhận native tool calling; tool tạo ảnh tự động bị bỏ qua.` });
      },
    });
    if (!execution || activeRunId !== this.runId || TERMINAL_STATUSES.has(this.status)) return null;

    const finishedAt = Date.now();
    const debug = {
      totalMs: finishedAt - startedAt,
      firstTokenMs: execution.firstTokenAt ? execution.firstTokenAt - startedAt : null,
      summary: summaryDebug,
      context: {
        historyTotal: historySnapshot.length,
        recentMessages: recentHistory.length,
        summaryChars: this.contextSummary.length,
      },
      loopGuard,
      research: research.debug,
      tools: { imageCalls: execution.imageCallsUsed },
      providerCalls: execution.providerDiagnostics,
    };
    const entry = {
      id: messageId,
      speaker: agentId,
      name: agent.name,
      text: execution.text,
      createdAt: new Date().toISOString(),
      usage: execution.usage,
      sources: research.sources,
      debug,
    };
    this.history.push(entry);
    this.addUsage(agentId, entry.usage, true);
    this.recordDebug('turn:done', { agentId, messageId, ...debug });
    this.emit('message:done', entry);
    return { entry };
  }

  reasoningStatusForConfig(config, mode) {
    if (mode === 'auto') return 'adaptive';
    if (isOfficialGpt56(config)) return 'verified';
    const cached = this.reasoningProbeCache?.get(`${providerCapabilityKey(config)}::${mode}`);
    return cached?.status || 'unknown';
  }

  reasoningCapabilitySummary() {
    const configs = Object.values(this.agentConfigs || {});
    return Object.fromEntries(MANUAL_REASONING_MODES.map((mode) => {
      const byAgent = Object.fromEntries(configs.map((config) => [config.id, this.reasoningStatusForConfig(config, mode)]));
      const statuses = Object.values(byAgent);
      let status = 'unknown';
      if (statuses.length && statuses.every((value) => value === 'verified')) status = 'verified';
      else if (statuses.some((value) => value === 'unsupported')) status = 'unsupported';
      else if (statuses.length && statuses.every((value) => value === 'verified' || value === 'accepted')) status = 'accepted';
      return [mode, { status, byAgent }];
    }));
  }

  snapshot() {
    const base = super.snapshot();
    return {
      ...base,
      reasoning: {
        mode: normalizeReasoningMode(this.reasoningMode, 'auto'),
        levels: this.reasoningCapabilitySummary(),
      },
    };
  }

  async probeReasoningMode(value) {
    const mode = normalizeReasoningMode(value, '');
    if (!mode || mode === 'auto') return { ok: true, mode: 'auto', levels: this.reasoningCapabilitySummary() };

    const grouped = new Map();
    for (const config of Object.values(this.agentConfigs || {})) {
      const key = providerCapabilityKey(config);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(config);
    }

    const results = [];
    for (const [providerKey, configs] of grouped.entries()) {
      const config = configs[0];
      const cacheKey = `${providerKey}::${mode}`;
      const cached = this.reasoningProbeCache?.get(cacheKey);
      if (cached) {
        results.push({ ...cached, agentIds: configs.map((item) => item.id) });
        continue;
      }

      if (isOfficialGpt56(config)) {
        const verified = { status: 'verified', mode, model: config.model, checkedAt: new Date().toISOString() };
        this.reasoningProbeCache?.set(cacheKey, verified);
        results.push({ ...verified, agentIds: configs.map((item) => item.id) });
        continue;
      }

      let probe;
      try {
        const provider = this.reasoningBaseProviderFactory(config);
        const result = await provider.streamChat({
          messages: [
            { role: 'system', content: 'Capability probe. Reply with exactly OK.' },
            { role: 'user', content: 'OK' },
          ],
          temperature: 0,
          maxOutputTokens: 8,
          reasoningEffort: mode,
          adaptiveReasoning: false,
          tools: [],
          onDelta: () => {},
        });
        const accepted = result?.diagnostics?.reasoningEffort === mode
          && result?.diagnostics?.reasoningControlSupport !== false;
        probe = {
          status: accepted ? 'accepted' : 'unsupported',
          mode,
          model: config.model,
          checkedAt: new Date().toISOString(),
          detail: accepted
            ? 'Provider chấp nhận reasoning_effort. Không thể xác minh provider có thực thi nội bộ đúng mức nếu họ không trả metadata chứng minh.'
            : 'Provider không giữ reasoning_effort ở request thành công cuối cùng.',
        };
      } catch (error) {
        probe = {
          status: 'unsupported',
          mode,
          model: config.model,
          checkedAt: new Date().toISOString(),
          detail: error?.message || String(error),
        };
      }

      this.reasoningProbeCache?.set(cacheKey, probe);
      results.push({ ...probe, agentIds: configs.map((item) => item.id) });
    }

    const unsupported = results.filter((item) => item.status === 'unsupported');
    if (unsupported.length) {
      const affected = unsupported.flatMap((item) => item.agentIds || []).join(', ');
      throw unsupportedReasoningError(mode, affected ? `Agent bị ảnh hưởng: ${affected}.` : '');
    }

    return { ok: true, mode, results, levels: this.reasoningCapabilitySummary() };
  }

  async setReasoningMode(value, { probe = true, emit = true } = {}) {
    const mode = normalizeReasoningMode(value, '');
    if (!mode) {
      const error = new Error(`Mức suy luận không hợp lệ. Dùng: ${['auto', ...MANUAL_REASONING_MODES].join(', ')}.`);
      error.code = 'INVALID_REASONING_MODE';
      throw error;
    }

    if (mode !== 'auto' && probe) await this.probeReasoningMode(mode);
    this.reasoningMode = mode;
    this.recordDebug?.('reasoning:mode', { mode, strict: mode !== 'auto' });
    if (emit) this.emitState?.();
    return this.snapshot();
  }

  async start(input = {}) {
    if (input?.reasoningMode) {
      await this.setReasoningMode(input.reasoningMode, { probe: input.reasoningMode !== 'auto', emit: false });
    }
    return super.start(input);
  }

  async continueFromHistory(input = {}) {
    if (input?.reasoningMode) {
      await this.setReasoningMode(input.reasoningMode, { probe: input.reasoningMode !== 'auto', emit: false });
    }
    return super.continueFromHistory(input);
  }
}
