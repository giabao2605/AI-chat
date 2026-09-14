import { randomUUID } from 'node:crypto';
import {
  PRIVATE_CONTEXT_TOOL,
  PRIVATE_CONTEXT_TOOL_NAME,
  parsePrivateContextToolCall,
} from './agent-tools.js';
import { ParallelBatchRoom } from './parallel-batch-room.js';

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function cleanText(value, maxLength) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function mergeUsage(total, usage) {
  if (!usage) return total;
  if (!total) {
    return {
      inputTokens: usage.inputTokens || 0,
      outputTokens: usage.outputTokens || 0,
      totalTokens: usage.totalTokens || 0,
      exact: usage.exact !== false,
    };
  }
  return {
    inputTokens: total.inputTokens + (usage.inputTokens || 0),
    outputTokens: total.outputTokens + (usage.outputTokens || 0),
    totalTokens: total.totalTokens + (usage.totalTokens || 0),
    exact: total.exact !== false && usage.exact !== false,
  };
}

function profilePrompt(profile) {
  const parts = [
    `Danh tính của bạn trong phòng này là ${profile.name}.`,
    'Hãy giữ nhất quán danh tính này trong suốt phiên.',
    'Không suy đoán hoặc khẳng định model, provider hay hạ tầng nội bộ của bản thân hoặc người khác nếu thông tin đó không được cung cấp trực tiếp trong hội thoại.',
  ];

  if (profile.prompt) {
    parts.push(profile.prompt);
  } else {
    if (profile.role) parts.push(`Vai trò chính: ${profile.role}`);
    if (profile.persona) parts.push(`Tính cách: ${profile.persona}`);
    if (profile.speakingStyle) parts.push(`Kiểu nói: ${profile.speakingStyle}`);
  }

  return parts.join('\n');
}

function sanitizePrivateContexts(value, agentIds = []) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(agentIds);
  return value.slice(-500).map((item) => {
    const senderId = cleanText(item?.senderId, 80).toLowerCase();
    const recipientId = cleanText(item?.recipientId, 80).toLowerCase();
    const content = cleanText(item?.content, 8000);
    if (!allowed.has(senderId) || !allowed.has(recipientId) || senderId === recipientId || !content) return null;
    return {
      id: cleanText(item?.id, 200) || randomUUID(),
      senderId,
      recipientId,
      content,
      createdAt: cleanText(item?.createdAt, 100) || new Date().toISOString(),
    };
  }).filter(Boolean);
}

function insertSystemMessage(messages, content) {
  if (!content) return Array.isArray(messages) ? messages : [];
  const next = Array.isArray(messages) ? [...messages] : [];
  let index = 0;
  while (index < next.length && next[index]?.role === 'system') index += 1;
  next.splice(index, 0, { role: 'system', content });
  return next;
}

export class ProfiledRoom extends ParallelBatchRoom {
  constructor(options = {}) {
    super(options);
    this.agentConfigs = Object.fromEntries(Object.entries(this.agentConfigs).map(([id, agent]) => [id, { ...agent }]));
    this.baseAgentNames = Object.fromEntries(Object.entries(this.agentConfigs).map(([id, agent]) => [id, agent.name]));
    this.agentProfiles = {};
    this.profileTurnActive = new Set();
    this.profileOverrideSuppressed = new Set();
    this.maxPrivateMessagesPerTurn = Math.floor(clamp(options.maxPrivateMessagesPerTurn, 1, 20, 8));
    this.maxPrivateContextChars = Math.floor(clamp(options.maxPrivateContextChars, 1000, 100000, 16000));
    this.privateContexts = Array.isArray(this.privateContexts) ? this.privateContexts : [];
    this.privateInboxVersion = this.privateInboxVersion || Object.fromEntries(this.agentIds.map((id) => [id, 0]));
    this.privateToolCallsUsed = this.privateToolCallsUsed || Object.fromEntries(this.agentIds.map((id) => [id, 0]));
    this.privateToolFallbackWarned = this.privateToolFallbackWarned || Object.fromEntries(this.agentIds.map((id) => [id, false]));
  }

  resetPrivateContextState(entries = []) {
    this.privateContexts = sanitizePrivateContexts(entries, this.agentIds || []);
    this.privateInboxVersion = Object.fromEntries((this.agentIds || []).map((id) => [id, 0]));
    for (const entry of this.privateContexts) {
      this.privateInboxVersion[entry.recipientId] = (this.privateInboxVersion[entry.recipientId] || 0) + 1;
    }
    this.privateToolCallsUsed = Object.fromEntries((this.agentIds || []).map((id) => [id, 0]));
    this.privateToolFallbackWarned = Object.fromEntries((this.agentIds || []).map((id) => [id, false]));
  }

  reset() {
    this.resetPrivateContextState([]);
    return super.reset();
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
        prompt: cleanText(raw.prompt, 12000),
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
    this.resetPrivateContextState([]);
    return super.start(this.prepareProfileInput(input));
  }

  async continueFromHistory(input = {}) {
    this.resetPrivateContextState(input?.session?.privateContexts || []);
    return super.continueFromHistory(this.prepareProfileInput(input));
  }

  snapshot() {
    const base = super.snapshot();
    const byAgent = Object.fromEntries(this.agentIds.map((id) => [id, {
      sent: this.privateContexts.filter((entry) => entry.senderId === id).length,
      received: this.privateContexts.filter((entry) => entry.recipientId === id).length,
    }]));
    return {
      ...base,
      agentProfiles: Object.fromEntries(Object.entries(this.agentProfiles || {}).map(([id, profile]) => [id, { ...profile }])),
      // The operator/client may persist these so a resumed session keeps its hidden state.
      // They are never copied into the shared transcript sent to other agents.
      privateContexts: this.privateContexts.map((entry) => ({ ...entry })),
      privateContextStats: { total: this.privateContexts.length, byAgent },
    };
  }

  privateToolForAgent(agentId) {
    const recipients = this.agentIds.filter((id) => id !== agentId);
    if (!recipients.length) return null;
    const labels = recipients.map((id) => `${id}=${this.agentConfigs[id]?.name || id}`).join(', ');
    return {
      ...PRIVATE_CONTEXT_TOOL,
      function: {
        ...PRIVATE_CONTEXT_TOOL.function,
        description: `${PRIVATE_CONTEXT_TOOL.function.description} Agent đích hợp lệ hiện tại: ${labels}.`,
        parameters: {
          ...PRIVATE_CONTEXT_TOOL.function.parameters,
          properties: {
            ...PRIVATE_CONTEXT_TOOL.function.parameters.properties,
            recipient: {
              ...PRIVATE_CONTEXT_TOOL.function.parameters.properties.recipient,
              enum: recipients,
            },
          },
        },
      },
    };
  }

  visiblePrivateContexts(agentId) {
    return this.privateContexts.filter((entry) => entry.senderId === agentId || entry.recipientId === agentId);
  }

  privateContextSystemBlock(agentId) {
    const visible = this.visiblePrivateContexts(agentId);
    if (!visible.length) return '';

    const selected = [];
    let chars = 0;
    for (let index = visible.length - 1; index >= 0; index -= 1) {
      const entry = visible[index];
      const otherId = entry.senderId === agentId ? entry.recipientId : entry.senderId;
      const otherName = this.agentConfigs[otherId]?.name || otherId;
      const direction = entry.senderId === agentId
        ? `Bạn đã gửi riêng cho ${otherName} (${otherId.toUpperCase()})`
        : `${otherName} (${otherId.toUpperCase()}) đã gửi riêng cho bạn`;
      const line = `- ${direction}: ${entry.content}`;
      if (selected.length && chars + line.length > this.maxPrivateContextChars) break;
      selected.push(line);
      chars += line.length;
    }
    selected.reverse();

    return `<private_agent_context>\nĐây là context RIÊNG của bạn, tách khỏi transcript chung. Chỉ bạn và đúng agent đối tác của từng mục được backend cấp nội dung tương ứng. Các AI khác không nhìn thấy dữ liệu này.\nKhông đọc nguyên văn, không nhắc rằng bạn nhận được private context/tool và không tiết lộ secret ra lời thoại công khai trừ khi mục tiêu hoặc chiến lược của bạn thực sự yêu cầu công khai. Bạn được phép suy luận và hành động dựa trên dữ liệu này.\n\n${selected.join('\n')}\n</private_agent_context>`;
  }

  recordPrivateContext(senderId, recipientId, content) {
    const sender = String(senderId || '').toLowerCase();
    const recipient = String(recipientId || '').toLowerCase();
    const cleaned = cleanText(content, 8000);
    if (!this.agentIds.includes(sender)) throw new Error(`Agent gửi '${sender}' không tồn tại trong phòng.`);
    if (!this.agentIds.includes(recipient)) throw new Error(`Agent nhận '${recipient}' không tồn tại trong phòng.`);
    if (sender === recipient) throw new Error('Không thể gửi private context cho chính mình.');
    if (!cleaned) throw new Error('Private context trống.');

    const entry = {
      id: randomUUID(),
      senderId: sender,
      recipientId: recipient,
      content: cleaned,
      createdAt: new Date().toISOString(),
    };
    this.privateContexts.push(entry);
    if (this.privateContexts.length > 500) this.privateContexts.splice(0, this.privateContexts.length - 500);
    this.privateInboxVersion[recipient] = (this.privateInboxVersion[recipient] || 0) + 1;

    const senderName = this.agentConfigs[sender]?.name || sender;
    const recipientName = this.agentConfigs[recipient]?.name || recipient;
    this.recordDebug('private-context:sent', {
      privateContextId: entry.id,
      senderId: sender,
      recipientId: recipient,
      chars: cleaned.length,
    });
    this.emit('meta', { text: `${senderName} đã gửi một context riêng cho ${recipientName}.` });
    if (this.isParallelMode() && this.status === 'running') this.queueParallelSchedule(this.runId, 0);
    return entry;
  }

  privateToolResultText(agentId, parsed, entry = null) {
    if (parsed?.error) return `Không gửi được private context: ${parsed.error}`;
    const recipientName = this.agentConfigs[parsed.recipient]?.name || parsed.recipient;
    return entry
      ? `Đã gửi private context cho ${recipientName} (${parsed.recipient.toUpperCase()}). Nội dung này không được thêm vào transcript chung.`
      : `Không gửi được private context cho ${recipientName} (${parsed.recipient.toUpperCase()}).`;
  }

  async streamChatWithPrivateContext(agentId, streamChat, options = {}) {
    const privateTool = this.privateToolForAgent(agentId);
    const maxCalls = this.maxPrivateMessagesPerTurn;
    let workingMessages = Array.isArray(options.messages) ? options.messages : [];
    let aggregateText = '';
    let aggregateUsage = null;
    let lastResult = null;
    let providerCalls = 0;

    while (providerCalls <= maxCalls + 1) {
      const used = this.privateToolCallsUsed[agentId] || 0;
      const canUsePrivateTool = Boolean(privateTool && used < maxCalls);
      const privateBlock = this.privateContextSystemBlock(agentId);
      const messages = insertSystemMessage(workingMessages, privateBlock);
      const baseTools = Array.isArray(options.tools)
        ? options.tools.filter((tool) => tool?.function?.name !== PRIVATE_CONTEXT_TOOL_NAME)
        : [];
      const tools = canUsePrivateTool ? [...baseTools, privateTool] : baseTools;

      const result = await streamChat({ ...options, messages, tools });
      providerCalls += 1;
      lastResult = result;
      if (result.text) aggregateText = aggregateText ? `${aggregateText}\n\n${result.text}` : result.text;
      aggregateUsage = mergeUsage(aggregateUsage, result.usage);

      if (result.toolFallback && canUsePrivateTool && !this.privateToolFallbackWarned[agentId]) {
        this.privateToolFallbackWarned[agentId] = true;
        const name = this.agentConfigs[agentId]?.name || agentId;
        this.emit('meta', { text: `${name}: provider không hỗ trợ native tool calling nên private context giữa AI đang không khả dụng.` });
      }

      const calls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
      const privateCalls = calls.filter((call) => call?.function?.name === PRIVATE_CONTEXT_TOOL_NAME);
      const otherCalls = calls.filter((call) => call?.function?.name !== PRIVATE_CONTEXT_TOOL_NAME);

      if (!privateCalls.length || !canUsePrivateTool) {
        return {
          ...result,
          text: aggregateText || result.text || '',
          usage: aggregateUsage || result.usage || null,
          toolCalls: otherCalls,
          diagnostics: {
            ...(result.diagnostics || {}),
            privateContextProviderCalls: providerCalls,
            privateContextCalls: this.privateToolCallsUsed[agentId] || 0,
          },
        };
      }

      const deliveryResults = [];
      for (const call of privateCalls) {
        if ((this.privateToolCallsUsed[agentId] || 0) >= maxCalls) break;
        this.privateToolCallsUsed[agentId] = (this.privateToolCallsUsed[agentId] || 0) + 1;
        const parsed = parsePrivateContextToolCall(call, {
          allowedRecipients: this.agentIds,
          senderId: agentId,
          maxContentLength: 8000,
        });
        if (!parsed) continue;
        if (parsed.error) {
          deliveryResults.push(this.privateToolResultText(agentId, parsed));
          continue;
        }
        const entry = this.recordPrivateContext(agentId, parsed.recipient, parsed.content);
        deliveryResults.push(this.privateToolResultText(agentId, parsed, entry));
      }

      if (otherCalls.length) {
        return {
          ...result,
          text: aggregateText || result.text || '',
          usage: aggregateUsage || result.usage || null,
          toolCalls: otherCalls,
          diagnostics: {
            ...(result.diagnostics || {}),
            privateContextProviderCalls: providerCalls,
            privateContextCalls: this.privateToolCallsUsed[agentId] || 0,
          },
        };
      }

      const resultText = deliveryResults.length
        ? deliveryResults.join('\n')
        : 'Không có private context hợp lệ nào được gửi.';
      workingMessages = [
        ...workingMessages,
        {
          role: 'user',
          content: `<private_context_tool_result>\n${resultText}\nTiếp tục lượt của bạn. Không lặp lại secret trong câu trả lời công khai.\n</private_context_tool_result>`,
        },
      ];
    }

    return {
      ...(lastResult || {}),
      text: aggregateText || lastResult?.text || '',
      usage: aggregateUsage || lastResult?.usage || null,
      toolCalls: (lastResult?.toolCalls || []).filter((call) => call?.function?.name !== PRIVATE_CONTEXT_TOOL_NAME),
      diagnostics: {
        ...(lastResult?.diagnostics || {}),
        privateContextProviderCalls: providerCalls,
        privateContextCalls: this.privateToolCallsUsed[agentId] || 0,
      },
    };
  }

  createProviders() {
    super.createProviders();
    for (const id of this.agentIds) {
      const provider = this.providers[id];
      if (!provider?.streamChat) continue;
      const streamChat = provider.streamChat.bind(provider);
      provider.streamChat = async (options = {}) => {
        const profile = this.agentProfiles?.[id];
        const agentTurn = profile && this.profileTurnActive.has(id) && !this.profileOverrideSuppressed.has(id);
        const profiledOptions = agentTurn ? {
          ...options,
          temperature: profile.temperature,
          maxOutputTokens: profile.maxOutputTokens,
        } : options;
        if (!agentTurn) return streamChat(profiledOptions);
        return this.streamChatWithPrivateContext(id, streamChat, profiledOptions);
      };
    }
  }

  async executeAgentTurn(agentId, activeRunId = this.runId) {
    const runtime = this.agentRuntime?.[agentId];
    if (runtime) runtime.privateContextSeenVersion = this.privateInboxVersion?.[agentId] || 0;
    this.privateToolCallsUsed[agentId] = 0;
    this.profileTurnActive.add(agentId);
    try {
      return await super.executeAgentTurn(agentId, activeRunId);
    } finally {
      this.profileTurnActive.delete(agentId);
      this.privateToolCallsUsed[agentId] = 0;
    }
  }

  hasUnseenParallelTrigger(agentId) {
    const runtime = this.agentRuntime?.[agentId];
    const delivered = this.privateInboxVersion?.[agentId] || 0;
    const seen = runtime?.privateContextSeenVersion || 0;
    if (delivered > seen) return true;
    return super.hasUnseenParallelTrigger(agentId);
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
