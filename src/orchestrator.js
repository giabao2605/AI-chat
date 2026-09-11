import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SHARED_PROMPT } from './config.js';
import { OpenAICompatibleProvider } from './provider.js';
import { buildWebResearchContext, decideWebResearch } from './research.js';

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function safeText(value, maxLength = 20000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function sourceMetadata(source) {
  return {
    id: source.id,
    title: source.title,
    url: source.url,
    domain: source.domain,
    age: source.age || '',
    query: source.query || '',
  };
}

export function buildMessagesForAgent({ agentId, agentName, topic, history, sharedPrompt, personaPrompt }) {
  const system = `${sharedPrompt || DEFAULT_SHARED_PROMPT}\n\nTên hiển thị của bạn trong phòng: ${agentName}.\n${personaPrompt ? `\nVai trò/phong cách bổ sung của bạn:\n${personaPrompt}` : ''}`;
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: `Chủ đề của phòng trò chuyện: ${topic}\n\nBắt đầu hoặc tiếp tục cuộc trò chuyện dựa trên transcript bên dưới.` },
  ];

  for (const item of history) {
    if (item.speaker === agentId) {
      messages.push({ role: 'assistant', content: item.text });
    } else {
      messages.push({ role: 'user', content: `${item.name}: ${item.text}` });
    }
  }
  return messages;
}

function blankStats() {
  return {
    a: { inputTokens: 0, outputTokens: 0, totalTokens: 0, turns: 0, estimatedTurns: 0 },
    b: { inputTokens: 0, outputTokens: 0, totalTokens: 0, turns: 0, estimatedTurns: 0 },
  };
}

export class ConversationRoom extends EventEmitter {
  constructor({ agentA, agentB, hardTurnLimit = 200, providerFactory, webSearch = null } = {}) {
    super();
    this.agentConfigs = { a: agentA, b: agentB };
    this.hardTurnLimit = hardTurnLimit;
    this.providerFactory = providerFactory || ((config) => new OpenAICompatibleProvider(config));
    this.webSearch = webSearch;
    this.providers = {};
    this.reset();
  }

  reset() {
    if (this.abortController) this.abortController.abort();
    this.runId = randomUUID();
    this.status = 'idle';
    this.topic = '';
    this.turn = 0;
    this.maxTurns = 20;
    this.history = [];
    this.stats = blankStats();
    this.currentSpeaker = null;
    this.settings = null;
    this.abortController = null;
    this.emitState();
  }

  snapshot() {
    return {
      runId: this.runId,
      status: this.status,
      topic: this.topic,
      turn: this.turn,
      maxTurns: this.maxTurns,
      currentSpeaker: this.currentSpeaker,
      history: this.history,
      stats: this.stats,
    };
  }

  emitState() {
    this.emit('state', this.snapshot());
  }

  validateAgents() {
    for (const id of ['a', 'b']) {
      const agent = this.agentConfigs[id];
      if (!agent?.apiKey || !agent?.model || !agent?.baseUrl) {
        throw new Error(`${agent?.name || `Agent ${id.toUpperCase()}`} chưa được cấu hình đủ API key, model và base URL.`);
      }
    }
  }

  async start(input = {}) {
    if (['running', 'paused', 'pausing'].includes(this.status)) throw new Error('Phòng đang chạy. Hãy dừng hoặc reset trước khi bắt đầu phiên mới.');
    this.validateAgents();

    this.runId = randomUUID();
    this.status = 'starting';
    this.turn = 0;
    this.history = [];
    this.stats = blankStats();
    this.currentSpeaker = null;
    this.maxTurns = Math.floor(clamp(input.maxTurns, 1, 100000, 20));
    if (this.hardTurnLimit > 0) this.maxTurns = Math.min(this.maxTurns, this.hardTurnLimit);

    this.settings = {
      topicMode: input.topicMode === 'auto' ? 'auto' : 'manual',
      sharedPrompt: safeText(input.sharedPrompt, 30000) || DEFAULT_SHARED_PROMPT,
      personaA: safeText(input.personaA, 10000),
      personaB: safeText(input.personaB, 10000),
      temperature: clamp(input.temperature, 0, 2, 0.8),
      maxOutputTokens: Math.floor(clamp(input.maxOutputTokens, 64, 16000, 1200)),
      startSpeaker: ['a', 'b', 'random'].includes(input.startSpeaker) ? input.startSpeaker : 'random',
    };

    this.providers = {
      a: this.providerFactory(this.agentConfigs.a),
      b: this.providerFactory(this.agentConfigs.b),
    };

    this.emitState();

    try {
      if (this.settings.topicMode === 'auto') {
        this.topic = await this.chooseTopic();
      } else {
        this.topic = safeText(input.topic, 5000);
        if (!this.topic) throw new Error('Hãy nhập chủ đề hoặc chọn chế độ AI tự chọn chủ đề.');
      }
    } catch (error) {
      this.status = error?.name === 'AbortError' ? 'stopped' : 'error';
      this.currentSpeaker = null;
      this.emitState();
      throw error;
    }

    this.status = 'running';
    this.emit('topic', { topic: this.topic });
    this.emitState();
    const activeRunId = this.runId;
    void this.runLoop(activeRunId);
    return this.snapshot();
  }

  async chooseTopic() {
    this.abortController = new AbortController();
    const agent = this.agentConfigs.a;
    const messages = [
      {
        role: 'system',
        content: 'Bạn đang chuẩn bị một cuộc trò chuyện tự do với một AI khác. Hãy chọn một chủ đề đủ cụ thể để hai bên có thể thảo luận nhiều lượt. Chỉ trả về tên/chủ đề trong tối đa 2 câu, không giải thích thêm.',
      },
      { role: 'user', content: 'Hãy tự chọn chủ đề mà bạn muốn nói chuyện với AI còn lại.' },
    ];
    this.emit('meta', { text: `${agent.name} đang tự chọn chủ đề...` });
    const result = await this.providers.a.streamChat({
      messages,
      temperature: 1,
      maxOutputTokens: 160,
      signal: this.abortController.signal,
      onDelta: () => {},
    });
    this.addUsage('a', result.usage, false);
    return result.text || 'AI nên hợp tác với con người như thế nào trong tương lai?';
  }

  firstSpeaker() {
    if (this.settings.startSpeaker === 'random') return Math.random() < 0.5 ? 'a' : 'b';
    return this.settings.startSpeaker;
  }

  async runLoop(activeRunId = this.runId) {
    let speaker = this.firstSpeaker();
    try {
      while (activeRunId === this.runId && this.turn < this.maxTurns && !['stopped', 'idle', 'error'].includes(this.status)) {
        await this.waitUntilRunnable();
        if (['stopped', 'idle', 'error'].includes(this.status)) break;
        await this.runAgentTurn(speaker, activeRunId);
        if (['stopped', 'idle', 'error'].includes(this.status)) break;
        this.turn += 1;
        speaker = speaker === 'a' ? 'b' : 'a';
        this.emitState();
      }
      if (activeRunId === this.runId && this.status === 'running' && this.turn >= this.maxTurns) {
        this.status = 'completed';
        this.currentSpeaker = null;
        this.emit('meta', { text: `Đã đạt giới hạn ${this.maxTurns} lượt.` });
        this.emitState();
      }
    } catch (error) {
      if (activeRunId !== this.runId) return;
      if (error?.name === 'AbortError' && ['stopped', 'idle'].includes(this.status)) return;
      this.status = 'error';
      this.currentSpeaker = null;
      this.emit('error', { message: error?.message || String(error) });
      this.emitState();
    }
  }

  async waitUntilRunnable() {
    while (this.status === 'paused' || this.status === 'pausing') {
      if (this.status === 'pausing') {
        this.status = 'paused';
        this.currentSpeaker = null;
        this.emitState();
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  async addWebResearch(agentId, messages, signal) {
    if (!this.webSearch) return [];
    const agent = this.agentConfigs[agentId];
    const plan = await decideWebResearch({
      provider: this.providers[agentId],
      topic: this.topic,
      history: this.history,
      agentName: agent.name,
      signal,
    });
    if (plan.usage) this.addUsage(agentId, plan.usage, false);
    if (!plan.search) return [];

    this.emit('research:start', {
      speaker: agentId,
      name: agent.name,
      queries: plan.queries,
      freshness: plan.freshness || null,
    });

    try {
      const research = await this.webSearch.searchMany({
        queries: plan.queries,
        freshness: plan.freshness,
        signal,
      });
      const context = buildWebResearchContext(research);
      const sources = research.sources.map(sourceMetadata);
      if (context) messages.splice(1, 0, { role: 'system', content: context });
      this.emit('research:done', { speaker: agentId, name: agent.name, queries: research.queries, sources });
      return sources;
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error;
      this.emit('research:error', { speaker: agentId, name: agent.name, message: error?.message || String(error) });
      messages.splice(1, 0, {
        role: 'system',
        content: 'Công cụ web vừa thất bại. Nếu câu trả lời phụ thuộc thông tin hiện tại, hãy nói rõ rằng bạn chưa xác minh được dữ liệu mới thay vì đoán.',
      });
      return [];
    }
  }

  async runAgentTurn(agentId, activeRunId = this.runId) {
    const agent = this.agentConfigs[agentId];
    const messageId = randomUUID();
    this.currentSpeaker = agentId;
    this.abortController = new AbortController();
    const messages = buildMessagesForAgent({
      agentId,
      agentName: agent.name,
      topic: this.topic,
      history: this.history,
      sharedPrompt: this.settings.sharedPrompt,
      personaPrompt: agentId === 'a' ? this.settings.personaA : this.settings.personaB,
    });

    let sources = [];
    try {
      sources = await this.addWebResearch(agentId, messages, this.abortController.signal);
    } catch (error) {
      if (error?.name === 'AbortError' || activeRunId !== this.runId) return;
      throw error;
    }
    if (activeRunId !== this.runId || ['stopped', 'idle', 'error'].includes(this.status)) return;

    this.emit('message:start', { id: messageId, speaker: agentId, name: agent.name });
    let result;
    try {
      result = await this.providers[agentId].streamChat({
        messages,
        temperature: this.settings.temperature,
        maxOutputTokens: this.settings.maxOutputTokens,
        signal: this.abortController.signal,
        onDelta: (delta) => {
          if (activeRunId === this.runId) this.emit('message:delta', { id: messageId, speaker: agentId, delta });
        },
      });
    } catch (error) {
      if (error?.name === 'AbortError' || activeRunId !== this.runId) {
        this.emit('message:cancelled', { id: messageId, speaker: agentId });
      } else {
        this.emit('message:failed', { id: messageId, speaker: agentId, message: error?.message || String(error) });
      }
      throw error;
    }

    if (activeRunId !== this.runId) return;
    const text = safeText(result.text, 100000);
    if (!text) throw new Error(`${agent.name} trả về nội dung rỗng.`);
    const entry = {
      id: messageId,
      speaker: agentId,
      name: agent.name,
      text,
      createdAt: new Date().toISOString(),
      usage: result.usage,
      sources,
    };
    this.history.push(entry);
    this.addUsage(agentId, result.usage, true);
    this.currentSpeaker = null;
    this.emit('message:done', entry);
  }

  addUsage(agentId, usage, countTurn) {
    const target = this.stats[agentId];
    target.inputTokens += usage?.inputTokens || 0;
    target.outputTokens += usage?.outputTokens || 0;
    target.totalTokens += usage?.totalTokens || 0;
    if (countTurn) target.turns += 1;
    if (usage && usage.exact === false) target.estimatedTurns += 1;
    this.emit('stats', this.stats);
  }

  addUserMessage(text) {
    const cleaned = safeText(text, 20000);
    if (!cleaned) throw new Error('Tin nhắn trống.');
    if (!this.topic) throw new Error('Chưa có phiên trò chuyện để tham gia.');
    const entry = {
      id: randomUUID(),
      speaker: 'user',
      name: 'Bạn',
      text: cleaned,
      createdAt: new Date().toISOString(),
      usage: null,
      sources: [],
    };
    this.history.push(entry);
    this.emit('message:done', entry);
    this.emitState();
    return entry;
  }

  pause() {
    if (this.status !== 'running') throw new Error('Phòng hiện không ở trạng thái đang chạy.');
    this.status = this.currentSpeaker ? 'pausing' : 'paused';
    this.emitState();
  }

  resume() {
    if (!['paused', 'pausing'].includes(this.status)) throw new Error('Phòng hiện không tạm dừng.');
    this.status = 'running';
    this.emitState();
  }

  stop() {
    if (!['starting', 'running', 'paused', 'pausing'].includes(this.status)) return;
    this.status = 'stopped';
    this.currentSpeaker = null;
    if (this.abortController) this.abortController.abort();
    this.emitState();
  }
}
