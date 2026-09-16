import { randomUUID } from 'node:crypto';
import { ReasoningMemoryProfiledRoom } from './reasoning-memory-room.js';
import {
  ScenarioController,
  buildScenarioActionTool,
  parseScenarioActionToolCall,
  scenarioContextBlocks,
} from './scenario.js';
import { WEREWOLF_SCENARIO } from './werewolf-scenario.js';

const SCENARIOS = Object.freeze({
  [WEREWOLF_SCENARIO.id]: WEREWOLF_SCENARIO,
});
const SECRET_PHASES = new Set(['night', 'night_resolution']);

function cleanScenarioId(value) {
  return String(value || '').trim().toLowerCase();
}

function transcriptForScenario(history = []) {
  return history.slice(-24).map((item) => {
    const name = String(item?.name || item?.speaker || '').slice(0, 120);
    const text = String(item?.text || '').trim().slice(0, 2400);
    return text ? `${name}: ${text}` : '';
  }).filter(Boolean).join('\n').slice(-30000);
}

function scenarioDisplayName(id) {
  return id === 'werewolf' ? 'Ma Sói' : id;
}

function scenarioEndReason(publicState = {}) {
  if (publicState.winner === 'wolves') return 'Ma Sói thắng.';
  if (publicState.winner === 'village') return 'Phe Dân Làng thắng.';
  return 'Scenario đã kết thúc.';
}

export class ScenarioRoom extends ReasoningMemoryProfiledRoom {
  constructor(options = {}) {
    super(options);
    this.scenarioController = null;
    this.scenarioSeedFactory = typeof options.scenarioSeedFactory === 'function'
      ? options.scenarioSeedFactory
      : () => randomUUID();
  }

  reset() {
    const result = super.reset();
    if (Object.prototype.hasOwnProperty.call(this, 'scenarioController')) this.scenarioController = null;
    return result;
  }

  scenarioDefinition(id) {
    return SCENARIOS[cleanScenarioId(id)] || null;
  }

  scenarioIdFromInput(input = {}) {
    return cleanScenarioId(input.scenarioId || input?.scenario?.id);
  }

  async start(input = {}) {
    const scenarioId = this.scenarioIdFromInput(input);
    if (!scenarioId) {
      this.scenarioController = null;
      return super.start(input);
    }

    const definition = this.scenarioDefinition(scenarioId);
    if (!definition) throw new Error(`Scenario không hỗ trợ: ${scenarioId}`);
    if (input.conversationMode === 'parallel' && !definition.conversationModes?.includes('parallel')) {
      const error = new Error(`${scenarioDisplayName(scenarioId)} hiện chỉ hỗ trợ chế độ lần lượt.`);
      error.code = 'SCENARIO_MODE_UNSUPPORTED';
      throw error;
    }

    const seed = this.scenarioSeedFactory({ scenarioId, runId: this.runId, agentIds: [...this.agentIds] });
    this.scenarioController = new ScenarioController({
      definition,
      agentIds: this.agentIds,
      options: { seed },
    });

    const nextInput = {
      ...input,
      topicMode: 'manual',
      conversationMode: 'turns',
      topic: String(input.topic || '').trim() || 'Ma Sói: suy luận, thảo luận và bỏ phiếu theo luật backend.',
    };

    try {
      return await super.start(nextInput);
    } catch (error) {
      this.scenarioController = null;
      throw error;
    }
  }

  async continueFromHistory(input = {}) {
    const sessionScenarioId = cleanScenarioId(input?.session?.scenario?.id || input?.scenarioId || input?.scenario?.id);
    if (sessionScenarioId) {
      const error = new Error('Scenario session chưa hỗ trợ resume/fork vì secret state không được lưu vào public history.');
      error.code = 'SCENARIO_RESUME_UNSUPPORTED';
      throw error;
    }

    const history = Array.isArray(input?.session?.history) ? input.session.history : [];
    const usedTurns = history.filter((item) => this.agentIds.includes(item?.speaker)).length;
    const requestedMaxTurns = Math.floor(Number(input?.maxTurns ?? input?.session?.maxTurns));
    if (usedTurns > 0 && Number.isFinite(requestedMaxTurns) && requestedMaxTurns <= usedTurns) {
      const error = new Error(`Phiên này đã dùng ${usedTurns}/${requestedMaxTurns} lượt. Hãy tăng số lượt trước khi tiếp tục.`);
      error.code = 'RESUME_TURN_LIMIT_REACHED';
      throw error;
    }

    this.scenarioController = null;
    return super.continueFromHistory(input);
  }

  snapshot() {
    const base = super.snapshot();
    const scenario = this.scenarioController?.publicSnapshot?.() || null;
    if (!scenario) return { ...base, scenario: null };
    const hideSpeaker = SECRET_PHASES.has(scenario.phase);
    return {
      ...base,
      ...(hideSpeaker ? { currentSpeaker: null, currentSpeakers: [] } : {}),
      scenario,
    };
  }

  firstSpeaker() {
    const scenario = this.scenarioController;
    const eligible = scenario ? scenario.eligibleSpeakers() : this.agentIds;
    if (!eligible.length) {
      if (scenario?.isComplete?.()) return this.agentIds[0] || 'a';
      if (scenario) throw new Error(`Scenario phase '${scenario.phase}' không có agent hợp lệ để chạy.`);
      return super.firstSpeaker();
    }
    return this.turnCoordinator?.firstSpeaker({
      baseOrder: this.agentIds,
      eligibleIds: eligible,
      requested: this.settings?.startSpeaker || 'random',
      randomize: !scenario,
    }) || super.firstSpeaker();
  }

  nextSpeaker(current) {
    const scenario = this.scenarioController;
    const eligible = scenario ? scenario.eligibleSpeakers() : this.agentIds;
    if (!eligible.length) {
      if (scenario?.isComplete?.()) return current;
      if (scenario) throw new Error(`Scenario phase '${scenario.phase}' không có agent hợp lệ để chạy.`);
      return super.nextSpeaker(current);
    }
    return this.turnCoordinator?.nextSpeaker({
      baseOrder: this.agentIds,
      eligibleIds: eligible,
      current,
    }) || super.nextSpeaker(current);
  }

  injectScenarioContext(agentId, messages) {
    if (!this.scenarioController || !Array.isArray(messages)) return messages;
    const blocks = scenarioContextBlocks(this.scenarioController, agentId);
    const assembled = this.contextAssembler.addScenarioContext(messages, blocks);
    messages.splice(0, messages.length, ...assembled);
    return messages;
  }

  async addWebResearch(agentId, messages, signal, historySnapshot) {
    const result = await super.addWebResearch(agentId, messages, signal, historySnapshot);
    this.injectScenarioContext(agentId, messages);
    return result;
  }

  async runScenarioActionTurn(agentId, activeRunId, controller) {
    const scenario = this.scenarioController;
    const tool = buildScenarioActionTool(scenario, agentId);
    if (!tool) throw new Error('Scenario không có action hợp lệ cho agent ở phase hiện tại.');

    const blocks = scenarioContextBlocks(scenario, agentId);
    const transcript = transcriptForScenario(this.history);
    const baseMessages = [
      {
        role: 'system',
        content: `${this.settings?.sharedPrompt || ''}\n\nBạn đang ở một lượt hành động kín của scenario. Không viết lời thoại công khai. Bắt buộc dùng tool scenario_action đúng một lần với một action hợp lệ do backend cung cấp.`,
      },
      ...(blocks.publicBlock ? [{ role: 'system', content: blocks.publicBlock }] : []),
      ...(blocks.privateBlock ? [{ role: 'system', content: blocks.privateBlock }] : []),
      ...(transcript ? [{ role: 'user', content: `<public_transcript>\n${transcript}\n</public_transcript>` }] : []),
      { role: 'user', content: 'Chọn hành động chiến thuật của bạn và gọi scenario_action ngay.' },
    ];

    const phaseBefore = scenario.phase;
    let lastError = null;
    this.profileOverrideSuppressed?.add(agentId);
    try {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (activeRunId !== this.runId || controller.signal.aborted) return null;
        const messages = attempt === 0 ? baseMessages : [
          ...baseMessages,
          { role: 'user', content: 'Lần trước không có action hợp lệ. Chỉ gọi scenario_action với đúng enum action/target đã được tool schema cho phép.' },
        ];
        const result = await this.providers[agentId].streamChat({
          messages,
          temperature: this.agentProfiles?.[agentId]?.temperature ?? this.settings?.temperature ?? 0.8,
          maxOutputTokens: Math.min(300, this.agentProfiles?.[agentId]?.maxOutputTokens ?? 300),
          signal: controller.signal,
          onDelta: () => {},
          tools: [tool],
          toolChoice: { type: 'function', function: { name: 'scenario_action' } },
        });
        const call = (result.toolCalls || []).find((item) => item?.function?.name === 'scenario_action');
        const parsed = parseScenarioActionToolCall(call);
        if (!parsed || parsed.error || !parsed.action) {
          lastError = new Error('Provider không trả scenario_action hợp lệ.');
          continue;
        }
        try {
          scenario.applyAction(agentId, parsed.action);
          this.recordDebug('scenario:state', {
            phaseBefore,
            phaseAfter: scenario.phase,
            stateVersion: scenario.stateVersion,
          });
          if (scenario.isComplete()) this.completeScenario();
          return { scenarioAction: true };
        } catch (error) {
          if (error?.code !== 'SCENARIO_ACTION_INVALID') throw error;
          lastError = error;
        }
      }
    } finally {
      this.profileOverrideSuppressed?.delete(agentId);
    }

    const error = new Error(lastError?.message || 'Provider không tạo được scenario action hợp lệ.');
    error.code = 'SCENARIO_ACTION_FAILED';
    throw error;
  }

  async runAgentTurn(agentId, activeRunId = this.runId, controller = new AbortController()) {
    const scenario = this.scenarioController;
    if (!scenario) return super.runAgentTurn(agentId, activeRunId, controller);
    if (!scenario.eligibleSpeakers().includes(agentId)) return null;

    if (scenario.legalActionsFor(agentId).length) {
      return this.runScenarioActionTurn(agentId, activeRunId, controller);
    }

    const outcome = await super.runAgentTurn(agentId, activeRunId, controller);
    if (outcome?.entry && activeRunId === this.runId && this.scenarioController === scenario) {
      scenario.onPublicMessage(agentId, { id: outcome.entry.id, text: outcome.entry.text });
      this.recordDebug('scenario:state', {
        phase: scenario.phase,
        stateVersion: scenario.stateVersion,
      });
      if (scenario.isComplete()) this.completeScenario();
    }
    return outcome;
  }

  completeScenario() {
    const scenario = this.scenarioController;
    if (!scenario?.isComplete?.()) return false;
    const publicState = scenario.publicState();
    this.status = 'completed';
    this.endedBy = 'scenario';
    this.endReason = scenarioEndReason(publicState);
    this.clearParallelWakeTimer?.();
    this.recordDebug('scenario:complete', {
      scenarioId: scenario.id,
      phase: scenario.phase,
      stateVersion: scenario.stateVersion,
      winner: publicState.winner || null,
      day: publicState.day || null,
    });
    this.emit('meta', { text: this.endReason });
    this.emitState();
    return true;
  }
}
