import { memoryQueryFromHistory } from './agent-memory.js';
import { ProfiledRoom } from './profiled-room.js';

const ACTIVE_ROOM_STATUSES = new Set(['starting', 'running', 'paused', 'pausing']);

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
    this.memoryInFlight = Object.fromEntries(this.agentIds.map((id) => [id, false]));
    this.memoryForceAfterFlight = Object.fromEntries(this.agentIds.map((id) => [id, false]));
    this.memoryErrorFlushedRunId = '';
    this.memoryStatsCache = Object.fromEntries(this.agentIds.map((id) => [id, { total: 0, byType: {} }]));
    this.lastMemoryRetrieval = Object.fromEntries(this.agentIds.map((id) => [id, { count: 0, at: null }]));
    this.legacyPrivateContextDeactivated = this.deactivateLegacyPrivateContextMemories();
    this.refreshMemoryStats();
  }

  memoryEnabled() {
    return Boolean(this.memoryManager?.enabled);
  }

  deactivateLegacyPrivateContextMemories() {
    if (!this.memoryEnabled() || !this.memoryManager?.store?.db?.prepare) return 0;
    try {
      const result = this.memoryManager.store.db.prepare(`
        UPDATE agent_memories
        SET active = 0, updated_at = ?
        WHERE active = 1
          AND memory_type = 'private'
          AND source_type = 'private_context'
      `).run(new Date().toISOString());
      return Number(result?.changes || 0);
    } catch (error) {
      this.recordDebug?.('memory:legacy-private-migration-error', { message: error?.message || String(error) });
      return 0;
    }
  }

  resetMemoryRuntime(cursor = 0) {
    this.memoryGeneration = Math.max(0, Number(this.memoryGeneration) || 0) + 1;
    this.memoryCursors = Object.fromEntries(this.agentIds.map((id) => [id, Math.max(0, Number(cursor) || 0)]));
    this.memoryQueues = Object.fromEntries(this.agentIds.map((id) => [id, Promise.resolve()]));
    this.memoryInFlight = Object.fromEntries(this.agentIds.map((id) => [id, false]));
    this.memoryForceAfterFlight = Object.fromEntries(this.agentIds.map((id) => [id, false]));
    this.memoryErrorFlushedRunId = '';
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

  emitState() {
    const shouldFlushError = this.status === 'error'
      && this.memoryEnabled()
      && this.memoryErrorFlushedRunId !== this.runId;
    const result = super.emitState();
    if (shouldFlushError) {
      this.memoryErrorFlushedRunId = this.runId;
      this.flushMemoryConsolidation();
    }
    return result;
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
    if (ACTIVE_ROOM_STATUSES.has(this.status)) return super.start(input);
    this.resetMemoryRuntime(0);
    return super.start(input);
  }

  async continueFromHistory(input = {}) {
    if (ACTIVE_ROOM_STATUSES.has(this.status)) return super.continueFromHistory(input);
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
          const query = memoryQueryFromHistory(this.history, this.topic);
          const { block, memories } = this.memoryManager.buildContextBlock(id, {
            query,
            roomId: this.roomId,
            runId: this.runId,
          });
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
    // Private context is session state, not long-term memory. It remains available
    // to sender + recipient through ProfiledRoom and is persisted only with the
    // resumable session snapshot. Do not auto-promote it into SQLite memory.
    return super.recordPrivateContext(senderId, recipientId, content);
  }

  queueMemoryConsolidation(agentId, { force = false } = {}) {
    if (!this.memoryEnabled() || !this.agentIds.includes(agentId)) return null;

    if (this.memoryInFlight?.[agentId]) {
      if (force) this.memoryForceAfterFlight[agentId] = true;
      return this.memoryQueues[agentId] || null;
    }

    const provider = this.memoryProviders[agentId];
    if (!provider) return null;

    const generation = this.memoryGeneration;
    const scheduledRunId = this.runId;
    const pendingForce = Boolean(this.memoryForceAfterFlight[agentId]);
    this.memoryInFlight[agentId] = true;
    this.memoryForceAfterFlight[agentId] = pendingForce || Boolean(force);

    const task = (async () => {
      let requestedForce = pendingForce || Boolean(force);

      while (this.memoryGeneration === generation && this.runId === scheduledRunId) {
        const start = Math.max(0, Number(this.memoryCursors[agentId]) || 0);
        const end = this.history.length;
        const count = Math.max(0, end - start);
        const forceThisPass = requestedForce || Boolean(this.memoryForceAfterFlight[agentId]);
        this.memoryForceAfterFlight[agentId] = false;
        requestedForce = false;

        if (!this.memoryManager.shouldConsolidate(count, { force: forceThisPass })) break;

        const events = this.history.slice(start, end).map(memoryEventSnapshot);
        if (!events.length) {
          this.memoryCursors[agentId] = end;
          break;
        }

        const scheduledTopic = this.topic;
        const scheduledPersona = this.settings?.personas?.[agentId] || '';
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
          break;
        }

        if (!stillCurrent) break;

        // The cursor marks successfully consolidated history only. Failed batches remain retryable.
        this.memoryCursors[agentId] = end;
        if (result?.usage) this.addUsage(agentId, result.usage, false);
        this.refreshMemoryStats(agentId);
        this.recordDebug('memory:consolidated', {
          agentId,
          runId: scheduledRunId,
          fromIndex: start,
          toIndex: end,
          eventCount: events.length,
          stored: result?.stored?.length || 0,
        });

        requestedForce = Boolean(this.memoryForceAfterFlight[agentId]);
        this.memoryForceAfterFlight[agentId] = false;
      }
    })();

    this.memoryQueues[agentId] = task
      .catch(() => {})
      .finally(() => {
        if (this.memoryGeneration !== generation || this.runId !== scheduledRunId) return;
        this.memoryInFlight[agentId] = false;
      });
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
    const wasActive = ACTIVE_ROOM_STATUSES.has(this.status);
    super.stop();
    if (wasActive) this.flushMemoryConsolidation();
  }
}
