import { MultiAgentRoom } from './multi-agent-room.js';

const PARALLEL_BATCH_DELAY_MS = 350;

function nowIso(ms = Date.now()) {
  return new Date(ms).toISOString();
}

function terminalStatus(status) {
  return ['stopped', 'idle', 'error', 'completed'].includes(status);
}

function cloneAgentState(value = {}) {
  return {
    status: value.status || 'idle',
    batchId: value.batchId || null,
    batchNumber: value.batchNumber || null,
    messageId: value.messageId || null,
    error: value.error || '',
    updatedAt: value.updatedAt || null,
  };
}

export class ParallelBatchRoom extends MultiAgentRoom {
  constructor(options = {}) {
    super(options);
    this.ensureParallelRuntime();
  }

  ensureParallelRuntime() {
    if (!(this.parallelMessageMeta instanceof Map)) this.parallelMessageMeta = new Map();
    if (!this.parallelAgentStates || typeof this.parallelAgentStates !== 'object') this.parallelAgentStates = {};
    if (!Array.isArray(this.parallelBaseOrder)) this.parallelBaseOrder = [];
    if (!Number.isFinite(this.parallelBatchNumber)) this.parallelBatchNumber = 0;
    if (!Number.isFinite(this.parallelStartSequence)) this.parallelStartSequence = 0;
    if (!('parallelBatch' in this)) this.parallelBatch = null;
    if (!('parallelPendingSchedule' in this)) this.parallelPendingSchedule = false;
    for (const id of this.agentIds || []) {
      if (!this.parallelAgentStates[id]) this.parallelAgentStates[id] = cloneAgentState();
    }
  }

  resetParallelRuntime() {
    this.parallelBatch = null;
    this.parallelBatchNumber = 0;
    this.parallelStartSequence = 0;
    this.parallelBaseOrder = [];
    this.parallelPendingSchedule = false;
    this.parallelMessageMeta = new Map();
    this.parallelAgentStates = Object.fromEntries((this.agentIds || []).map((id) => [id, cloneAgentState()]));
  }

  reset() {
    this.resetParallelRuntime();
    return super.reset();
  }

  async start(input = {}) {
    this.resetParallelRuntime();
    return super.start(input);
  }

  async continueFromHistory(input = {}) {
    this.resetParallelRuntime();
    return super.continueFromHistory(input);
  }

  snapshot() {
    const base = super.snapshot();
    this.ensureParallelRuntime();
    const batch = this.parallelBatch;
    return {
      ...base,
      parallelBatch: batch ? {
        id: batch.id,
        number: batch.number,
        status: batch.status,
        agents: [...batch.agents],
        startedAt: batch.startedAt,
        finishedAt: batch.finishedAt || null,
        successes: batch.successes || 0,
        failures: batch.failures || 0,
        settled: batch.settled || 0,
      } : null,
      agentStates: Object.fromEntries((this.agentIds || []).map((id) => [id, cloneAgentState(this.parallelAgentStates[id])])),
    };
  }

  emit(eventName, payload) {
    this.ensureParallelRuntime();
    if (this.isParallelMode?.() && payload && typeof payload === 'object') {
      const speaker = payload.speaker;
      if (eventName === 'research:start' && this.agentIds.includes(speaker)) {
        this.setParallelAgentState(speaker, 'researching');
      } else if ((eventName === 'research:done' || eventName === 'research:error') && this.agentIds.includes(speaker)) {
        this.setParallelAgentState(speaker, 'thinking', { error: eventName === 'research:error' ? payload.message || '' : '' });
      } else if (eventName === 'message:start' && this.agentIds.includes(speaker)) {
        const runtime = this.agentRuntime?.[speaker] || {};
        const startedAtMs = Date.now();
        const meta = {
          batchId: runtime.batchId || this.parallelBatch?.id || null,
          batchNumber: runtime.batchNumber || this.parallelBatch?.number || null,
          startSequence: ++this.parallelStartSequence,
          startedAt: nowIso(startedAtMs),
          startedAtMs,
        };
        this.parallelMessageMeta.set(payload.id, meta);
        Object.assign(payload, meta);
        this.setParallelAgentState(speaker, 'streaming', { messageId: payload.id });
      } else if ((eventName === 'message:delta' || eventName === 'message:cancelled' || eventName === 'message:failed') && payload.id) {
        const meta = this.parallelMessageMeta.get(payload.id);
        if (meta) Object.assign(payload, meta);
        if (eventName === 'message:cancelled' && this.agentIds.includes(speaker)) this.setParallelAgentState(speaker, 'cancelled', { messageId: payload.id });
        if (eventName === 'message:failed' && this.agentIds.includes(speaker)) this.setParallelAgentState(speaker, 'failed', { messageId: payload.id, error: payload.message || '' });
      } else if (eventName === 'message:done' && this.agentIds.includes(speaker)) {
        const meta = this.parallelMessageMeta.get(payload.id);
        if (meta) {
          Object.assign(payload, meta, { finishedAt: nowIso() });
          this.sortHistoryByTimeline();
        }
        this.setParallelAgentState(speaker, 'done', { messageId: payload.id });
      }
    }
    return super.emit(eventName, payload);
  }

  setParallelAgentState(agentId, status, extra = {}) {
    if (!this.agentIds?.includes(agentId)) return;
    this.ensureParallelRuntime();
    const runtime = this.agentRuntime?.[agentId] || {};
    const previous = this.parallelAgentStates[agentId] || {};
    const next = {
      ...previous,
      status,
      batchId: extra.batchId ?? runtime.batchId ?? this.parallelBatch?.id ?? previous.batchId ?? null,
      batchNumber: extra.batchNumber ?? runtime.batchNumber ?? this.parallelBatch?.number ?? previous.batchNumber ?? null,
      messageId: extra.messageId ?? previous.messageId ?? null,
      error: extra.error ?? (['failed'].includes(status) ? previous.error || '' : ''),
      updatedAt: nowIso(),
    };
    this.parallelAgentStates[agentId] = next;
    super.emit('parallel:agent-status', { agentId, name: this.agentConfigs?.[agentId]?.name || agentId, ...cloneAgentState(next) });
  }

  sortHistoryByTimeline() {
    if (!Array.isArray(this.history) || this.history.length < 2) return;
    this.history = this.history
      .map((item, index) => {
        const start = item?.startedAt ? Date.parse(item.startedAt) : NaN;
        const created = item?.createdAt ? Date.parse(item.createdAt) : NaN;
        return {
          item,
          index,
          time: Number.isFinite(start) ? start : Number.isFinite(created) ? created : index,
          sequence: Number.isFinite(Number(item?.startSequence)) ? Number(item.startSequence) : Number.MAX_SAFE_INTEGER,
        };
      })
      .sort((a, b) => (a.time - b.time) || (a.sequence - b.sequence) || (a.index - b.index))
      .map(({ item }) => item);
  }

  baseParallelOrder() {
    if (this.parallelBaseOrder.length) return this.parallelBaseOrder;
    const first = this.firstSpeaker();
    const startIndex = Math.max(0, this.agentIds.indexOf(first));
    this.parallelBaseOrder = [...this.agentIds.slice(startIndex), ...this.agentIds.slice(0, startIndex)];
    return this.parallelBaseOrder;
  }

  orderForBatch(number) {
    const base = this.baseParallelOrder();
    if (!base.length) return [];
    const shift = Math.max(0, number - 1) % base.length;
    return [...base.slice(shift), ...base.slice(0, shift)];
  }

  startParallelMode(activeRunId = this.runId) {
    this.ensureParallelRuntime();
    this.baseParallelOrder();
    this.emit('meta', { text: `Chế độ song song theo round: ${this.agentIds.length} AI stream đồng thời; round sau chỉ bắt đầu khi round hiện tại đã kết thúc.` });
    this.openParallelBatch(activeRunId);
  }

  scheduleParallelAgents(activeRunId = this.runId) {
    this.openParallelBatch(activeRunId);
  }

  queueParallelSchedule(activeRunId = this.runId, delayMs = PARALLEL_BATCH_DELAY_MS) {
    if (activeRunId !== this.runId || !this.isParallelMode() || this.status !== 'running') return;
    this.ensureParallelRuntime();
    if (this.parallelBatch) {
      this.parallelPendingSchedule = true;
      return;
    }
    this.clearParallelWakeTimer();
    this.parallelWakeTimer = setTimeout(() => {
      this.parallelWakeTimer = null;
      this.openParallelBatch(activeRunId);
    }, Math.max(0, delayMs));
  }

  openParallelBatch(activeRunId = this.runId) {
    this.ensureParallelRuntime();
    if (activeRunId !== this.runId || !this.isParallelMode() || this.status !== 'running' || this.parallelBatch) return;
    if (this.turn >= this.maxTurns) {
      this.completeAtLimit();
      return;
    }

    const remaining = Math.max(0, this.maxTurns - this.turn);
    const number = ++this.parallelBatchNumber;
    const agents = this.orderForBatch(number).slice(0, remaining);
    if (!agents.length) {
      this.completeAtLimit();
      return;
    }

    const batch = {
      id: `${this.runId}:parallel:${number}`,
      number,
      status: 'running',
      agents,
      startedAt: nowIso(),
      finishedAt: null,
      successes: 0,
      failures: 0,
      settled: 0,
    };
    this.parallelBatch = batch;
    this.parallelPendingSchedule = false;

    for (const agentId of agents) {
      const runtime = this.agentRuntime?.[agentId];
      if (runtime) {
        runtime.batchId = batch.id;
        runtime.batchNumber = batch.number;
      }
      this.setParallelAgentState(agentId, 'queued', { batchId: batch.id, batchNumber: batch.number, messageId: null, error: '' });
    }

    super.emit('parallel:batch', {
      id: batch.id,
      number: batch.number,
      status: 'started',
      agents: [...batch.agents],
      startedAt: batch.startedAt,
      remainingTurns: remaining,
    });
    this.recordDebug('parallel:batch-start', { batchId: batch.id, batchNumber: batch.number, agents: [...batch.agents], turn: this.turn });
    this.emitState();

    void Promise.all(agents.map((agentId) => this.runParallelBatchAgent(agentId, batch, activeRunId)))
      .then((results) => this.finishParallelBatch(batch, activeRunId, results))
      .catch((error) => {
        this.recordDebug('parallel:batch-internal-error', { batchId: batch.id, message: error?.message || String(error) });
        this.finishParallelBatch(batch, activeRunId, []);
      });
  }

  async runParallelBatchAgent(agentId, batch, activeRunId) {
    this.setParallelAgentState(agentId, 'thinking', { batchId: batch.id, batchNumber: batch.number, messageId: null, error: '' });
    try {
      const outcome = await this.executeAgentTurn(agentId, activeRunId);
      if (activeRunId !== this.runId || terminalStatus(this.status)) return { agentId, attempted: false, success: false, cancelled: true };
      if (outcome?.entry) {
        this.setParallelAgentState(agentId, 'done', { batchId: batch.id, batchNumber: batch.number, messageId: outcome.entry.id });
        return { agentId, attempted: true, success: true, entry: outcome.entry };
      }
      return { agentId, attempted: true, success: false };
    } catch (error) {
      const cancelled = error?.name === 'AbortError' || activeRunId !== this.runId || ['stopped', 'idle', 'completed'].includes(this.status);
      if (cancelled) {
        this.setParallelAgentState(agentId, 'cancelled', { batchId: batch.id, batchNumber: batch.number, error: '' });
        return { agentId, attempted: false, success: false, cancelled: true };
      }
      const message = error?.message || String(error);
      this.setParallelAgentState(agentId, 'failed', { batchId: batch.id, batchNumber: batch.number, error: message });
      this.recordDebug('parallel:agent-error', { agentId, batchId: batch.id, batchNumber: batch.number, message });
      return { agentId, attempted: true, success: false, error: message };
    } finally {
      const runtime = this.agentRuntime?.[agentId];
      if (runtime) {
        delete runtime.batchId;
        delete runtime.batchNumber;
      }
    }
  }

  finishParallelBatch(batch, activeRunId, results) {
    if (activeRunId !== this.runId || this.parallelBatch?.id !== batch.id) return;
    const attempted = results.filter((result) => result?.attempted).length;
    const successes = results.filter((result) => result?.success).length;
    const failures = results.filter((result) => result?.attempted && !result?.success).length;
    batch.settled = results.length;
    batch.successes = successes;
    batch.failures = failures;
    batch.status = 'completed';
    batch.finishedAt = nowIso();

    if (!['stopped', 'idle'].includes(this.status)) this.turn += attempted;
    this.sortHistoryByTimeline();

    super.emit('parallel:batch', {
      id: batch.id,
      number: batch.number,
      status: 'completed',
      agents: [...batch.agents],
      startedAt: batch.startedAt,
      finishedAt: batch.finishedAt,
      successes,
      failures,
      attempted,
      turn: this.turn,
      maxTurns: this.maxTurns,
    });
    this.recordDebug('parallel:batch-done', { batchId: batch.id, batchNumber: batch.number, successes, failures, attempted, turn: this.turn });
    this.parallelBatch = null;

    if (this.status === 'pausing') {
      this.status = 'paused';
      this.emitState();
      return;
    }

    this.emitState();
    if (this.status !== 'running') return;
    if (this.completeAtLimit()) return;
    this.queueParallelSchedule(activeRunId, PARALLEL_BATCH_DELAY_MS);
  }
}
