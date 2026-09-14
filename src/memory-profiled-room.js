import { memoryQueryFromMessages } from './agent-memory.js';
import { ProfiledRoom } from './profiled-room.js';

function insertMemoryDataMessage(messages, content) {
  if (!content) return Array.isArray(messages) ? messages : [];
  const next = Array.isArray(messages) ? [...messages] : [];
  let index = 0;
  while (index < next.length && next[index]?.role === 'system') index += 1;
  next.splice(index, 0, { role: 'user', content });
  return next;
}

function memoryEventSnapshot(item = {}) {
  return {
    id: String(item.id || '').slice(0, 240),
    speaker: String(item.speaker || '').slice(0, 80),
    name: String(item.name || '').slice(0, 240),
    text: String(item.text || '').slice(0, 100000),
    createdAt: String(item.createdAt || '').slice(0, 100),
  };
}

export class MemoryProfiledRoom extends ProfiledRoom {
  constructor(options = {}) {
    super(options);
    this.roomId = String(options.roomId || 'default-room');
    this.memoryManager = options.memoryManager || null;
    this.memoryProviders = {};
    this.memoryGeneration = 0;
    this.memoryCursors = Object.fromEntries(this.agentIds.map((id) => [id, 0]));
    this.memoryQueues = Object.fromEntries(this.agentIds.map((id) => [id, Promise.resolve()]));
    this.memoryStatsCache = Object.fromEntries(this.agentIds.map((id) => [id, { total: 0, byType: {} }]));
    this.lastMemoryRetrieval = Object.fromEntries(this.agentIds.map((id) => [id, { count: 0, at: null }]));
    this.refreshMemoryStats();
  }

  memoryEnabled() {
    return Boolean(this.memoryManager?.enabled);
  }

  resetMemoryRuntime(cursor = 0) {
    this.memoryGeneration = Math.max(0, Number(this.memoryGeneration) || 0) + 1;
    this.memoryCursors = Object.fromEntries(this.agentIds.map((id) => [id, Math.max(0, Number(cursor) || 0)]));
    this.memoryQueues = Object.fromEntries(this.agentIds.map((id) => [id, Promise.resolve()]));
    this.lastMemoryRetrieval = Object.fromEntries(this.agentIds.map((id) => [id, { count: 0, at: null }]));
    this.refreshMemoryStats();
  }

  refreshMemoryStats(agentId = '') {
    if (!this.memoryEnabled()) return;
    const ids = agentId && this.agentIds.includes(agentId) ? [agentId] : this.agentIds;
    for (const id of ids) {
      try {
        this.memoryStatsCache[id] = this.memoryManager.stats(id, { roomId: this.roomId });
      } catch (error) {
        this.recordDebug?.('memory:stats-error', { agentId: id, message: error?.message || String(error) });
      }
    }
  }

  reset() {
    const initialized = Object.prototype.hasOwnProperty.call(this, 'memoryManager');
    if (initialized && this.memoryEnabled() && Array.isArray(this.history) && this.history.length) {
      this.flushMemoryConsolidation();
    }
    const result = super.reset();
    if (initialized) this.resetMemoryRuntime(0);
    return result;
  }

  async start(input = {}) {
    this.resetMemoryRuntime(0);
    return super.start(input);
  }

  async continueFromHistory(input = {}) {
    const cursor = Array.isArray(input?.session?.history) ? input.session.history.length : 0;
    this.resetMemoryRuntime(cursor);
    return super.continueFromHistory(input);
  }

  snapshot() {
    const base = super.snapshot();
    return {
      ...base,
      memory: {
        enabled: this.memoryEnabled(),
        scope: this.memoryManager?.scope || 'agent',
        byAgent: Object.fromEntries(this.agentIds.map((id) => [id, {
          ...(this.memoryStatsCache?.[id] || { total: 0, byType: {} }),
          lastRetrieval: this.lastMemoryRetrieval?.[id] || { count: 0, at: null },
        }])),
      },
    };
  }

  createProviders() {
    super.createProviders();
    if (!this.memoryEnabled()) return;

    this.memoryProviders = Object.fromEntries(this.agentIds.map((id) => [id, this.providerFactory(this.agentConfigs[id])]));
    for (const id of this.agentIds) {
      const provider = this.providers[id];
      if (!provider?.streamChat) continue;
      const profiledStream = provider.streamChat.bind(provider);
      provider.streamChat = async (options = {}) => {
        const agentTurn = this.profileTurnActive.has(id) && !this.profileOverrideSuppressed.has(id);
        if (!agentTurn || !this.memoryEnabled()) return profiledStream(options);

        try {
          const query = memoryQueryFromMessages(options.messages, this.topic);
          const { block, memories } = this.memoryManager.buildContextBlock(id, { query, roomId: this.roomId });
          this.lastMemoryRetrieval[id] = { count: memories.length, at: new Date().toISOString() };
          if (memories.length) {
            this.recordDebug('memory:retrieval', {
              agentId: id,
              count: memories.length,
              memoryIds: memories.map((memory) => memory.id),
            });
          }
          return profiledStream({
            ...options,
            messages: insertMemoryDataMessage(options.messages, block),
          });
        } catch (error) {
          this.recordDebug('memory:retrieval-error', { agentId: id, message: error?.message || String(error) });
          return profiledStream(options);
        }
      };
    }
  }

  recordPrivateContext(senderId, recipientId, content) {
    const entry = super.recordPrivateContext(senderId, recipientId, content);
    if (entry && this.memoryEnabled()) {
      try {
        const stored = this.memoryManager.rememberPrivateContext(entry, this.agentConfigs, {
          roomId: this.roomId,
          runId: this.runId,
        });
        this.refreshMemoryStats(senderId);
        this.refreshMemoryStats(recipientId);
        this.recordDebug('memory:private-stored', {
          privateContextId: entry.id,
          senderId,
          recipientId,
          stored: stored.length,
        });
      } catch (error) {
        this.recordDebug('memory:private-error', {
          privateContextId: entry.id,
          message: error?.message || String(error),
        });
      }
    }
    return entry;
  }

  queueMemoryConsolidation(agentId, { force = false } = {}) {
    if (!this.memoryEnabled() || !this.agentIds.includes(agentId)) return null;

    const start = Math.max(0, Number(this.memoryCursors[agentId]) || 0);
    const end = this.history.length;
    const count = Math.max(0, end - start);
    if (!this.memoryManager.shouldConsolidate(count, { force })) return null;

    const events = this.history.slice(start, end).map(memoryEventSnapshot);
    if (!events.length) {
      this.memoryCursors[agentId] = end;
      return null;
    }

    const provider = this.memoryProviders[agentId];
    if (!provider) return null;

    // Reserve the range synchronously. The queued task uses only this immutable snapshot,
    // so a reset/new session can never make old consolidation read the new room history.
    this.memoryCursors[agentId] = end;
    const generation = this.memoryGeneration;
    const scheduledRunId = this.runId;
    const scheduledTopic = this.topic;
    const scheduledPersona = this.settings?.personas?.[agentId] || '';
    const previous = this.memoryQueues[agentId] || Promise.resolve();

    const task = previous.then(async () => {
      let result = null;
      let lastError = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          result = await this.memoryManager.consolidate({
            agentId,
            agentName: this.agentConfigs[agentId]?.name || agentId,
            persona: scheduledPersona,
            provider,
            events,
            roomId: this.roomId,
            runId: scheduledRunId,
            topic: scheduledTopic,
          });
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      const stillCurrent = this.memoryGeneration === generation && this.runId === scheduledRunId;
      if (lastError) {
        if (stillCurrent) {
          this.recordDebug('memory:consolidation-error', {
            agentId,
            runId: scheduledRunId,
            fromIndex: start,
            toIndex: end,
            message: lastError?.message || String(lastError),
          });
        }
        return;
      }

      if (result?.usage && stillCurrent) this.addUsage(agentId, result.usage, false);
      this.refreshMemoryStats(agentId);
      if (stillCurrent) {
        this.recordDebug('memory:consolidated', {
          agentId,
          runId: scheduledRunId,
          fromIndex: start,
          toIndex: end,
          eventCount: events.length,
          stored: result?.stored?.length || 0,
        });
      }
    });

    this.memoryQueues[agentId] = task.catch(() => {});
    return this.memoryQueues[agentId];
  }

  flushMemoryConsolidation() {
    if (!this.memoryEnabled()) return;
    for (const id of this.agentIds) this.queueMemoryConsolidation(id, { force: true });
  }

  async executeAgentTurn(agentId, activeRunId = this.runId) {
    const outcome = await super.executeAgentTurn(agentId, activeRunId);
    if (outcome?.entry) this.queueMemoryConsolidation(agentId);
    return outcome;
  }

  completeAtLimit() {
    const completed = super.completeAtLimit();
    if (completed) this.flushMemoryConsolidation();
    return completed;
  }

  stop() {
    const wasActive = ['starting', 'running', 'paused', 'pausing'].includes(this.status);
    super.stop();
    if (wasActive) this.flushMemoryConsolidation();
  }
}
