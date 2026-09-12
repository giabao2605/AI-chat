import { MultiAgentRoom } from './multi-agent-room.js';

const PARALLEL_REPLY_COOLDOWN_MS = 80;

function nowIso(ms = Date.now()) {
  return new Date(ms).toISOString();
}

function terminalStatus(status) {
  return ['stopped', 'idle', 'error', 'completed'].includes(status);
}

function cloneAgentState(value = {}) {
  return {
    status: value.status || 'idle',
    messageId: value.messageId || null,
    error: value.error || '',
    updatedAt: value.updatedAt || null,
  };
}

// Kept under the old class name for compatibility with ProfiledRoom/server imports.
// Runtime semantics are now free-running: there is no round/batch barrier.
export class ParallelBatchRoom extends MultiAgentRoom {
  constructor(options = {}) {
    super(options);
    this.ensureParallelRuntime();
  }

  ensureParallelRuntime() {
    if (!(this.parallelMessageMeta instanceof Map)) this.parallelMessageMeta = new Map();
    if (!this.parallelAgentStates || typeof this.parallelAgentStates !== 'object') this.parallelAgentStates = {};
    if (!Array.isArray(this.parallelBaseOrder)) this.parallelBaseOrder = [];
    if (!Number.isFinite(this.parallelStartSequence)) this.parallelStartSequence = 0;
    if (!Number.isFinite(this.parallelScheduleCursor)) this.parallelScheduleCursor = 0;
    if (!Number.isFinite(this.parallelReservedTurns)) this.parallelReservedTurns = 0;
    for (const id of this.agentIds || []) {
      if (!this.parallelAgentStates[id]) this.parallelAgentStates[id] = cloneAgentState();
    }
  }

  resetParallelRuntime() {
    this.parallelStartSequence = 0;
    this.parallelScheduleCursor = 0;
    this.parallelReservedTurns = 0;
    this.parallelBaseOrder = [];
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
    return {
      ...base,
      // Legacy field intentionally stays null so old clients do not infer rounds.
      parallelBatch: null,
      parallelScheduler: {
        mode: 'free',
        reservedTurns: this.parallelReservedTurns,
        startSequence: this.parallelStartSequence,
      },
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
        const startedAtMs = Date.now();
        const meta = {
          startSequence: ++this.parallelStartSequence,
          startedAt: nowIso(startedAtMs),
          startedAtMs,
        };
        this.parallelMessageMeta.set(payload.id, meta);
        Object.assign(payload, meta);
        this.setParallelAgentState(speaker, 'streaming', { messageId: payload.id, error: '' });
      } else if ((eventName === 'message:delta' || eventName === 'message:cancelled' || eventName === 'message:failed') && payload.id) {
        const meta = this.parallelMessageMeta.get(payload.id);
        if (meta) Object.assign(payload, meta);
        if (eventName === 'message:cancelled' && this.agentIds.includes(speaker)) {
          this.setParallelAgentState(speaker, 'cancelled', { messageId: payload.id, error: '' });
        }
        if (eventName === 'message:failed' && this.agentIds.includes(speaker)) {
          this.setParallelAgentState(speaker, 'failed', { messageId: payload.id, error: payload.message || '' });
        }
      } else if (eventName === 'message:done' && this.agentIds.includes(speaker)) {
        const meta = this.parallelMessageMeta.get(payload.id);
        if (meta) {
          Object.assign(payload, meta, { finishedAt: nowIso() });
          this.sortHistoryByTimeline();
        }
        this.setParallelAgentState(speaker, 'done', { messageId: payload.id, error: '' });
      }
    }
    return super.emit(eventName, payload);
  }

  setParallelAgentState(agentId, status, extra = {}) {
    if (!this.agentIds?.includes(agentId)) return;
    this.ensureParallelRuntime();
    const previous = this.parallelAgentStates[agentId] || {};
    const next = {
      ...previous,
      status,
      messageId: Object.prototype.hasOwnProperty.call(extra, 'messageId') ? extra.messageId : (previous.messageId ?? null),
      error: Object.prototype.hasOwnProperty.call(extra, 'error') ? extra.error : (status === 'failed' ? previous.error || '' : ''),
      updatedAt: nowIso(),
    };
    this.parallelAgentStates[agentId] = next;
    super.emit('parallel:agent-status', {
      agentId,
      name: this.agentConfigs?.[agentId]?.name || agentId,
      ...cloneAgentState(next),
    });
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

  nextSchedulingOrder() {
    const base = this.baseParallelOrder();
    if (!base.length) return [];
    const shift = this.parallelScheduleCursor % base.length;
    this.parallelScheduleCursor = (this.parallelScheduleCursor + 1) % base.length;
    return [...base.slice(shift), ...base.slice(0, shift)];
  }

  startParallelMode(activeRunId = this.runId) {
    this.ensureParallelRuntime();
    this.baseParallelOrder();
    this.emit('meta', {
      text: `Chế độ song song tự do: ${this.agentIds.length} AI hoạt động độc lập; AI nào sẵn sàng có thể bắt đầu lượt mới mà không chờ các AI khác.`,
    });
    this.scheduleParallelAgents(activeRunId, { initial: true });
  }

  availableParallelSlots() {
    return Math.max(0, this.maxTurns - this.turn - this.parallelReservedTurns);
  }

  canStartParallelAgent(agentId, initial = false) {
    if (!this.isParallelMode() || this.status !== 'running') return false;
    const runtime = this.agentRuntime?.[agentId];
    if (!runtime || runtime.running || runtime.parallelReserved) return false;
    if (this.availableParallelSlots() <= 0) return false;
    if (initial && this.history.length === 0) return true;
    return this.hasUnseenParallelTrigger(agentId);
  }

  scheduleParallelAgents(activeRunId = this.runId, { initial = false } = {}) {
    if (activeRunId !== this.runId || !this.isParallelMode() || this.status !== 'running') return;
    this.ensureParallelRuntime();

    for (const agentId of this.nextSchedulingOrder()) {
      if (this.availableParallelSlots() <= 0) break;
      if (!this.canStartParallelAgent(agentId, initial)) continue;
      const runtime = this.agentRuntime?.[agentId];
      if (!runtime) continue;
      runtime.parallelReserved = true;
      this.parallelReservedTurns += 1;
      this.setParallelAgentState(agentId, 'queued', { messageId: null, error: '' });
      void this.launchFreeParallelAgent(agentId, activeRunId);
    }

    this.emitState();
    this.completeAtLimit();
  }

  queueParallelSchedule(activeRunId = this.runId, delayMs = PARALLEL_REPLY_COOLDOWN_MS) {
    if (activeRunId !== this.runId || !this.isParallelMode() || this.status !== 'running') return;
    this.clearParallelWakeTimer();
    this.parallelWakeTimer = setTimeout(() => {
      this.parallelWakeTimer = null;
      this.scheduleParallelAgents(activeRunId);
    }, Math.max(0, delayMs));
  }

  async launchFreeParallelAgent(agentId, activeRunId = this.runId) {
    let attempted = false;
    let success = false;
    let cancelled = false;
    let errorMessage = '';

    this.setParallelAgentState(agentId, 'thinking', { messageId: null, error: '' });
    try {
      const outcome = await this.executeAgentTurn(agentId, activeRunId);
      if (activeRunId !== this.runId || terminalStatus(this.status)) {
        cancelled = true;
      } else {
        attempted = true;
        success = Boolean(outcome?.entry);
        if (success) {
          this.setParallelAgentState(agentId, 'done', { messageId: outcome.entry.id, error: '' });
        }
      }
    } catch (error) {
      cancelled = error?.name === 'AbortError'
        || activeRunId !== this.runId
        || ['stopped', 'idle', 'completed'].includes(this.status);
      if (cancelled) {
        this.setParallelAgentState(agentId, 'cancelled', { messageId: null, error: '' });
      } else {
        attempted = true;
        errorMessage = error?.message || String(error);
        this.setParallelAgentState(agentId, 'failed', { messageId: null, error: errorMessage });
        this.recordDebug('parallel:agent-error', { agentId, message: errorMessage });
      }
    } finally {
      const runtime = this.agentRuntime?.[agentId];
      if (runtime?.parallelReserved) {
        runtime.parallelReserved = false;
        this.parallelReservedTurns = Math.max(0, this.parallelReservedTurns - 1);
      }
    }

    if (activeRunId !== this.runId) return;
    if (attempted && !['stopped', 'idle'].includes(this.status)) this.turn += 1;
    this.sortHistoryByTimeline();
    this.recordDebug('parallel:agent-settled', {
      agentId,
      success,
      cancelled,
      error: errorMessage,
      turn: this.turn,
      reservedTurns: this.parallelReservedTurns,
    });

    if (this.status === 'pausing' && this.runningAgentCount() === 0 && this.parallelReservedTurns === 0) {
      this.status = 'paused';
      this.emitState();
      return;
    }

    this.emitState();
    if (this.status !== 'running') return;
    if (this.completeAtLimit()) return;
    this.queueParallelSchedule(activeRunId, PARALLEL_REPLY_COOLDOWN_MS);
  }

  completeAtLimit() {
    if (this.status !== 'running'
      || this.turn < this.maxTurns
      || this.runningAgentCount() > 0
      || this.parallelReservedTurns > 0) return false;
    return super.completeAtLimit();
  }
}
