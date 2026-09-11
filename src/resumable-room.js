import { randomUUID } from 'node:crypto';
import { DEFAULT_SHARED_PROMPT } from './config.js';
import { ConversationRoom } from './orchestrator.js';

const ACTIVE_STATUSES = new Set(['starting', 'running', 'paused', 'pausing']);
const RESUMABLE_STATUSES = new Set(['completed', 'stopped', 'error']);

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function safeText(value, maxLength = 20000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function nonNegativeInt(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function sanitizeUsage(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    inputTokens: nonNegativeInt(value.inputTokens),
    outputTokens: nonNegativeInt(value.outputTokens),
    totalTokens: nonNegativeInt(value.totalTokens),
    exact: value.exact !== false,
  };
}

function sanitizeSources(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 20).map((source) => ({
    id: safeText(source?.id, 120),
    title: safeText(source?.title, 500),
    url: safeText(source?.url, 3000),
    domain: safeText(source?.domain, 300),
    age: safeText(source?.age, 120),
    query: safeText(source?.query, 1000),
  })).filter((source) => source.url || source.title);
}

function sanitizeAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).map((attachment) => {
    if (attachment?.type !== 'image') return null;
    const url = safeText(attachment?.url, 2000);
    if (!url.startsWith('/generated/')) return null;
    return {
      type: 'image',
      url,
      alt: safeText(attachment?.alt, 12000),
      prompt: safeText(attachment?.prompt, 12000),
      revisedPrompt: safeText(attachment?.revisedPrompt, 12000),
      size: safeText(attachment?.size, 100),
      model: safeText(attachment?.model, 500),
    };
  }).filter(Boolean);
}

function sanitizeHistory(history, agentConfigs) {
  if (!Array.isArray(history)) return [];
  return history.slice(-1000).map((item) => {
    const speaker = ['a', 'b', 'user', 'tool'].includes(item?.speaker) ? item.speaker : null;
    const text = safeText(item?.text, 100000);
    if (!speaker || !text) return null;
    const fallbackName = speaker === 'user'
      ? 'Bạn'
      : speaker === 'tool'
        ? 'Image Generator'
        : agentConfigs[speaker]?.name || `Agent ${speaker.toUpperCase()}`;
    const requestedBy = ['a', 'b'].includes(item?.requestedBy) ? item.requestedBy : undefined;
    return {
      id: safeText(item?.id, 200) || randomUUID(),
      speaker,
      name: safeText(item?.name, 300) || fallbackName,
      text,
      createdAt: safeText(item?.createdAt, 100) || new Date().toISOString(),
      usage: sanitizeUsage(item?.usage),
      sources: sanitizeSources(item?.sources),
      attachments: sanitizeAttachments(item?.attachments),
      ...(requestedBy ? { requestedBy } : {}),
    };
  }).filter(Boolean);
}

function countAiTurns(history) {
  return history.reduce((count, item) => count + (item.speaker === 'a' || item.speaker === 'b' ? 1 : 0), 0);
}

function nextSpeaker(history, fallback = 'a') {
  const latestAi = [...history].reverse().find((item) => item.speaker === 'a' || item.speaker === 'b');
  if (latestAi?.speaker === 'a') return 'b';
  if (latestAi?.speaker === 'b') return 'a';
  return ['a', 'b'].includes(fallback) ? fallback : 'a';
}

function sanitizeStats(stats, history) {
  const output = {};
  for (const id of ['a', 'b']) {
    const source = stats?.[id] || {};
    output[id] = {
      inputTokens: nonNegativeInt(source.inputTokens),
      outputTokens: nonNegativeInt(source.outputTokens),
      totalTokens: nonNegativeInt(source.totalTokens),
      turns: history.filter((item) => item.speaker === id).length,
      estimatedTurns: nonNegativeInt(source.estimatedTurns),
    };
  }
  return output;
}

export class ResumableConversationRoom extends ConversationRoom {
  async continueFromHistory(input = {}) {
    if (ACTIVE_STATUSES.has(this.status)) {
      throw new Error('Phòng hiện tại vẫn đang hoạt động. Hãy dừng phiên hiện tại trước khi tiếp tục một phiên cũ.');
    }
    this.validateAgents();

    const session = input?.session;
    if (!session || typeof session !== 'object') throw new Error('Dữ liệu phiên cũ không hợp lệ.');
    if (!RESUMABLE_STATUSES.has(session.status)) {
      throw new Error('Chỉ có thể tiếp tục phiên đã dừng, hoàn thành hoặc gặp lỗi.');
    }

    const topic = safeText(session.topic, 5000);
    const history = sanitizeHistory(session.history, this.agentConfigs);
    if (!topic || history.length === 0) throw new Error('Phiên cũ không có đủ dữ liệu để tiếp tục.');

    const usedTurns = countAiTurns(history);
    let savedMaxTurns = Math.floor(clamp(session.maxTurns, 1, 100000, Math.max(20, usedTurns)));
    if (this.hardTurnLimit > 0) savedMaxTurns = Math.min(savedMaxTurns, this.hardTurnLimit);

    let targetMaxTurns = savedMaxTurns;
    if (usedTurns >= savedMaxTurns) {
      targetMaxTurns = Math.floor(clamp(input.maxTurns, 1, 100000, savedMaxTurns));
      if (this.hardTurnLimit > 0) targetMaxTurns = Math.min(targetMaxTurns, this.hardTurnLimit);
    }

    if (usedTurns >= targetMaxTurns) {
      const hardLimitText = this.hardTurnLimit > 0 ? ` Trần an toàn của server là ${this.hardTurnLimit} lượt.` : '';
      throw new Error(`Phiên này đã dùng ${usedTurns}/${targetMaxTurns} lượt. Hãy tăng “Số lượt” lên trên ${usedTurns} trước khi tiếp tục.${hardLimitText}`);
    }

    const fallbackSpeaker = ['a', 'b'].includes(input.startSpeaker) ? input.startSpeaker : 'a';
    const savedMode = session.conversationMode === 'parallel' ? 'parallel' : null;
    const requestedMode = input.conversationMode === 'parallel' ? 'parallel' : 'turns';

    this.resetExecutionState();
    this.runId = safeText(session.runId, 200) || randomUUID();
    this.status = 'running';
    this.topic = topic;
    this.turn = usedTurns;
    this.maxTurns = targetMaxTurns;
    this.history = history;
    this.stats = sanitizeStats(session.stats, history);
    this.endedBy = null;
    this.endReason = '';
    this.visionFallbackWarned = { a: false, b: false };
    this.toolFallbackWarned = { a: false, b: false };
    this.settings = {
      topicMode: 'manual',
      conversationMode: savedMode || requestedMode,
      sharedPrompt: safeText(input.sharedPrompt, 30000) || DEFAULT_SHARED_PROMPT,
      personaA: safeText(input.personaA, 10000),
      personaB: safeText(input.personaB, 10000),
      temperature: clamp(input.temperature, 0, 2, 0.8),
      maxOutputTokens: Math.floor(clamp(input.maxOutputTokens, 64, 16000, 1200)),
      startSpeaker: nextSpeaker(history, fallbackSpeaker),
    };

    this.providers = {
      a: this.providerFactory(this.agentConfigs.a),
      b: this.providerFactory(this.agentConfigs.b),
    };

    this.emit('topic', { topic: this.topic });
    this.emit('meta', { text: `Đã tiếp tục phiên cũ tại lượt ${usedTurns}/${targetMaxTurns}${this.isParallelMode() ? ' ở chế độ song song' : ''}.` });
    this.emitState();
    const activeRunId = this.runId;
    if (this.isParallelMode()) this.startParallelMode(activeRunId);
    else void this.runLoop(activeRunId);
    return this.snapshot();
  }
}
