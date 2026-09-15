function chatEndpoint(baseUrl) {
  const normalized = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('Provider base URL is missing.');
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  return `${normalized}/chat/completions`;
}

const REASONING_EFFORTS = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
const RETRYABLE_STATUSES = new Set([400, 404, 415, 422]);
const CAPABILITY_CACHE = new Map();

function adaptiveModel(model) {
  return /^gpt-5\.6(?:-|$)/i.test(String(model || '').trim());
}

function normalizeReasoningEffort(value, fallback = '') {
  const effort = String(value || '').trim().toLowerCase();
  return REASONING_EFFORTS.has(effort) ? effort : fallback;
}

function normalizePromptCacheKey(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_.:-]/g, '_').slice(0, 64);
}

function officialOpenAIEndpoint(endpoint) {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return host === 'api.openai.com';
  } catch {
    return false;
  }
}

function capabilityKey(endpoint, model) {
  return `${String(endpoint || '').toLowerCase()}::${String(model || '').toLowerCase()}`;
}

function capabilityState(endpoint, model) {
  const key = capabilityKey(endpoint, model);
  if (CAPABILITY_CACHE.has(key)) return CAPABILITY_CACHE.get(key);
  const official = officialOpenAIEndpoint(endpoint);
  const adaptive = adaptiveModel(model);
  const state = {
    official,
    visionSupport: null,
    toolSupport: null,
    // Avoid speculative stream_options/cache probes on generic gateways. They are
    // optional optimizations and a rejected probe can cost an entire model round trip.
    streamUsageSupport: official ? true : false,
    reasoningControlSupport: adaptive ? (official ? true : null) : false,
    promptCacheSupport: adaptive && official ? true : false,
  };
  CAPABILITY_CACHE.set(key, state);
  return state;
}

export function resetProviderCapabilityCacheForTests() {
  CAPABILITY_CACHE.clear();
}

function effortRank(effort) {
  return { none: 0, low: 1, medium: 2, high: 3, xhigh: 4, max: 5 }[effort] ?? -1;
}

function maxEffort(a, b) {
  return effortRank(a) >= effortRank(b) ? a : b;
}

function messageTextStats(messages = []) {
  let totalChars = 0;
  let messageCount = 0;
  let latestUser = '';
  for (const message of messages) {
    const text = contentToText(message?.content);
    if (text) totalChars += text.length;
    messageCount += 1;
    if (message?.role === 'user' && text.trim()) latestUser = text;
  }
  const lineCount = latestUser ? latestUser.split(/\r?\n/).length : 0;
  const structuredMarks = (latestUser.match(/[{}\[\]()`]|```|=>|->|==|!=|<=|>=/g) || []).length;
  return { totalChars, messageCount, latestUserChars: latestUser.length, lineCount, structuredMarks };
}

// This is deliberately structural, not a keyword router. It never calls another model.
// A cheap turn stays low; only context/task pressure that is already visible in the
// request raises the reasoning budget before the one provider request is sent.
export function selectAdaptiveReasoningEffort(messages = [], {
  requested = 'low',
  multimodal = false,
} = {}) {
  const base = normalizeReasoningEffort(requested, 'low');
  if (effortRank(base) >= effortRank('high')) return base;

  const stats = messageTextStats(messages);
  let score = 0;
  if (stats.latestUserChars >= 1200) score += 1;
  if (stats.latestUserChars >= 4000) score += 1;
  if (stats.totalChars >= 12000) score += 1;
  if (stats.totalChars >= 30000) score += 1;
  if (stats.messageCount >= 24) score += 1;
  if (stats.lineCount >= 30 || stats.structuredMarks >= 20) score += 1;
  if (multimodal) score += 1;

  if (score >= 5) return maxEffort(base, 'high');
  if (score >= 2) return maxEffort(base, 'medium');
  return base;
}

function imagePartUrl(part) {
  const raw = typeof part?.image_url === 'string' ? part.image_url : part?.image_url?.url;
  const url = String(raw || '').trim();
  if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(url)) return url;
  if (/^https:\/\//i.test(url)) return url;
  return '';
}

export function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (part?.type === 'text') return String(part.text || '');
    if (part?.type === 'image_url' && imagePartUrl(part)) return '[image]';
    return '';
  }).filter(Boolean).join('\n');
}

function normalizeContentForProvider(content) {
  if (!Array.isArray(content)) return String(content ?? '');
  const parts = [];
  for (const part of content) {
    if (typeof part === 'string') {
      if (part.trim()) parts.push({ type: 'text', text: part });
      continue;
    }
    if (part?.type === 'text') {
      const text = String(part.text || '');
      if (text.trim()) parts.push({ type: 'text', text });
      continue;
    }
    if (part?.type === 'image_url') {
      const url = imagePartUrl(part);
      if (!url) continue;
      parts.push({
        type: 'image_url',
        image_url: {
          url,
          ...(part?.image_url?.detail ? { detail: part.image_url.detail } : {}),
        },
      });
    }
  }
  return parts.length ? parts : '';
}

export function estimateTokensFromText(text) {
  const chars = String(text || '').length;
  return chars === 0 ? 0 : Math.max(1, Math.ceil(chars / 4));
}

export function estimateUsage(messages, outputText) {
  const inputText = messages.map((message) => `${message.role}:${contentToText(message.content)}`).join('\n');
  const inputTokens = estimateTokensFromText(inputText);
  const outputTokens = estimateTokensFromText(outputText);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    exact: false,
  };
}

export function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const inputTokens = Number(raw.prompt_tokens ?? raw.input_tokens ?? 0);
  const outputTokens = Number(raw.completion_tokens ?? raw.output_tokens ?? 0);
  const totalTokens = Number(raw.total_tokens ?? inputTokens + outputTokens);
  if (![inputTokens, outputTokens, totalTokens].some((value) => Number.isFinite(value) && value > 0)) return null;
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : inputTokens + outputTokens,
    exact: true,
  };
}

export function normalizeMessagesForProvider(messages = []) {
  const systemParts = [];
  const rest = [];
  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const role = String(message.role || '');
    const content = normalizeContentForProvider(message.content);
    if (role === 'system') {
      const systemText = contentToText(content).trim();
      if (systemText) systemParts.push(systemText);
    } else {
      rest.push({ ...message, role, content });
    }
  }
  if (!systemParts.length) return rest;
  return [{ role: 'system', content: systemParts.join('\n\n') }, ...rest];
}

export function hasImageInput(messages = []) {
  return messages.some((message) => Array.isArray(message?.content)
    && message.content.some((part) => part?.type === 'image_url' && imagePartUrl(part)));
}

export function toTextOnlyMessages(messages = []) {
  return messages.map((message) => {
    if (!Array.isArray(message?.content)) return message;
    const text = message.content.map((part) => {
      if (typeof part === 'string') return part;
      if (part?.type === 'text') return String(part.text || '');
      if (part?.type === 'image_url') return '[Ảnh đính kèm không được provider này chấp nhận ở lượt hiện tại.]';
      return '';
    }).filter(Boolean).join('\n');
    return { ...message, content: text };
  });
}

function extractDelta(payload) {
  const content = payload?.choices?.[0]?.delta?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => typeof part === 'string' ? part : (part?.text || '')).join('');
  return '';
}

function collectToolCallDeltas(payload, target) {
  const chunks = payload?.choices?.[0]?.delta?.tool_calls;
  if (!Array.isArray(chunks)) return false;
  let changed = false;
  for (const chunk of chunks) {
    const index = Number.isInteger(chunk?.index) ? chunk.index : target.length;
    if (!target[index]) {
      target[index] = { index, id: '', type: 'function', function: { name: '', arguments: '' } };
      changed = true;
    }
    const call = target[index];
    if (chunk?.id) call.id = String(chunk.id);
    if (chunk?.type) call.type = String(chunk.type);
    if (chunk?.function?.name) {
      const nameChunk = String(chunk.function.name);
      if (!call.function.name) call.function.name = nameChunk;
      else if (call.function.name !== nameChunk && !call.function.name.endsWith(nameChunk)) call.function.name += nameChunk;
      changed = true;
    }
    if (chunk?.function?.arguments) {
      call.function.arguments += String(chunk.function.arguments);
      changed = true;
    }
  }
  return changed;
}

export function normalizeToolCalls(toolCalls = []) {
  return toolCalls.filter(Boolean).map((call, index) => ({
    id: String(call.id || `tool_call_${index}`),
    type: 'function',
    function: {
      name: String(call?.function?.name || '').trim(),
      arguments: String(call?.function?.arguments || ''),
    },
  })).filter((call) => call.function.name);
}

function combinedSignal(parent, timeoutMs) {
  const timeout = AbortSignal.timeout(Math.max(1000, Number(timeoutMs) || 120000));
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

async function requestStream({ endpoint, apiKey, body, signal, includeUsage, timeoutMs }) {
  const payload = includeUsage ? { ...body, stream_options: { include_usage: true } } : body;
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
    signal: combinedSignal(signal, timeoutMs),
  });
}

function errorTextForFeature(errorText, feature) {
  const text = String(errorText || '').toLowerCase();
  if (!text) return false;
  if (feature === 'streamUsage') return /stream[_ -]?options|include[_ -]?usage/.test(text);
  if (feature === 'promptCache') return /prompt[_ -]?cache|cache[_ -]?key/.test(text);
  if (feature === 'reasoning') return /reasoning[_ -]?effort|reasoning\.effort|reasoning effort/.test(text);
  if (feature === 'vision') return /image[_ -]?url|image input|vision|multimodal/.test(text);
  if (feature === 'tools') return /tool[_ -]?choice|\btools?\b|function[_ -]?calling|function call/.test(text);
  return false;
}

export class OpenAICompatibleProvider {
  constructor({ baseUrl, apiKey, model, timeoutMs = 120000, circuitFailureThreshold = 3, circuitCooldownMs = 30000 }) {
    this.endpoint = chatEndpoint(baseUrl);
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 120000);
    this.circuitFailureThreshold = Math.max(1, Number(circuitFailureThreshold) || 3);
    this.circuitCooldownMs = Math.max(1000, Number(circuitCooldownMs) || 30000);
    this.failureCount = 0;
    this.circuitOpenUntil = 0;
    this.capabilities = capabilityState(this.endpoint, this.model);
  }

  circuitState(now = Date.now()) {
    if (this.circuitOpenUntil > now) return 'open';
    if (this.circuitOpenUntil) return 'half-open';
    return 'closed';
  }

  assertCircuit() {
    if (this.circuitOpenUntil > Date.now()) {
      const waitMs = this.circuitOpenUntil - Date.now();
      const error = new Error(`Provider circuit breaker đang mở. Thử lại sau khoảng ${Math.ceil(waitMs / 1000)} giây.`);
      error.code = 'PROVIDER_CIRCUIT_OPEN';
      throw error;
    }
  }

  registerSuccess() {
    this.failureCount = 0;
    this.circuitOpenUntil = 0;
  }

  registerFailure() {
    this.failureCount += 1;
    if (this.failureCount >= this.circuitFailureThreshold) this.circuitOpenUntil = Date.now() + this.circuitCooldownMs;
  }

  async streamChat(options = {}) {
    this.assertCircuit();
    const started = Date.now();
    try {
      const result = await this.#streamChat(options, started);
      this.registerSuccess();
      return {
        ...result,
        diagnostics: {
          ...(result.diagnostics || {}),
          elapsedMs: Date.now() - started,
          timeoutMs: this.timeoutMs,
          circuit: this.circuitState(),
        },
      };
    } catch (error) {
      if (!options?.signal?.aborted) this.registerFailure();
      throw error;
    }
  }

  async #streamChat({
    messages,
    temperature = 0.8,
    maxOutputTokens = 1200,
    signal,
    onDelta = () => {},
    tools = [],
    toolChoice = 'auto',
    reasoningEffort = '',
    adaptiveReasoning = false,
    promptCacheKey = '',
  }, overallStarted) {
    const providerMessages = normalizeMessagesForProvider(messages);
    const multimodal = hasImageInput(providerMessages);
    const externalTools = Array.isArray(tools) ? tools.filter(Boolean) : [];
    const modelCanAdapt = adaptiveModel(this.model);
    const capabilities = this.capabilities;
    const cacheKey = modelCanAdapt ? normalizePromptCacheKey(promptCacheKey) : '';
    const requestedEffort = normalizeReasoningEffort(reasoningEffort, adaptiveReasoning && modelCanAdapt ? 'low' : '');
    const selectedEffort = adaptiveReasoning && modelCanAdapt
      ? selectAdaptiveReasoningEffort(providerMessages, { requested: requestedEffort || 'low', multimodal })
      : requestedEffort;

    let visionFallback = multimodal && capabilities.visionSupport === false;
    let useTools = externalTools.length > 0 && capabilities.toolSupport !== false;
    let toolFallback = externalTools.length > 0 && capabilities.toolSupport === false;
    let useReasoning = Boolean(modelCanAdapt && selectedEffort && capabilities.reasoningControlSupport !== false);
    let usePromptCache = Boolean(modelCanAdapt && cacheKey && capabilities.promptCacheSupport === true);
    let includeUsage = capabilities.streamUsageSupport === true;
    const attempts = [];
    const disabledThisCall = new Set();
    let body = null;
    let response = null;

    const makeBody = () => ({
      model: this.model,
      messages: visionFallback ? toTextOnlyMessages(providerMessages) : providerMessages,
      stream: true,
      temperature,
      max_tokens: maxOutputTokens,
      ...(useReasoning ? { reasoning_effort: selectedEffort } : {}),
      ...(usePromptCache ? { prompt_cache_key: cacheKey } : {}),
      ...(useTools ? {
        tools: externalTools,
        tool_choice: toolChoice || 'auto',
        parallel_tool_calls: true,
      } : {}),
    });

    const doRequest = async () => {
      body = makeBody();
      const started = Date.now();
      const res = await requestStream({
        endpoint: this.endpoint,
        apiKey: this.apiKey,
        body,
        signal,
        includeUsage,
        timeoutMs: this.timeoutMs,
      });
      attempts.push({
        status: res.status,
        ok: res.ok,
        headersMs: Date.now() - started,
        streamUsage: includeUsage,
        reasoningEffort: useReasoning ? selectedEffort : null,
        promptCache: usePromptCache,
        tools: useTools,
        vision: multimodal && !visionFallback,
        retryReason: null,
      });
      return res;
    };

    // Retry only when the provider explicitly identifies an unsupported capability.
    // Never walk a blind fallback ladder for a generic 400: each speculative retry can
    // cost another full model queue/TTFT and was the main source of multi-second stalls.
    for (let guard = 0; guard < 6; guard += 1) {
      response = await doRequest();
      if (response.ok) break;

      const errorText = (await response.text()).slice(0, 4000);
      if (!RETRYABLE_STATUSES.has(response.status)) {
        throw new Error(`Provider returned HTTP ${response.status}: ${errorText || response.statusText}`);
      }

      let feature = '';
      if (includeUsage && !disabledThisCall.has('streamUsage') && errorTextForFeature(errorText, 'streamUsage')) feature = 'streamUsage';
      else if (usePromptCache && !disabledThisCall.has('promptCache') && errorTextForFeature(errorText, 'promptCache')) feature = 'promptCache';
      else if (useReasoning && !disabledThisCall.has('reasoning') && errorTextForFeature(errorText, 'reasoning')) feature = 'reasoning';
      else if (multimodal && !visionFallback && !disabledThisCall.has('vision') && errorTextForFeature(errorText, 'vision')) feature = 'vision';
      else if (useTools && !disabledThisCall.has('tools') && errorTextForFeature(errorText, 'tools')) feature = 'tools';

      if (!feature) {
        throw new Error(`Provider returned HTTP ${response.status}: ${errorText || response.statusText}`);
      }

      disabledThisCall.add(feature);
      attempts[attempts.length - 1].retryReason = feature;
      if (feature === 'streamUsage') {
        includeUsage = false;
        capabilities.streamUsageSupport = false;
      } else if (feature === 'promptCache') {
        usePromptCache = false;
        capabilities.promptCacheSupport = false;
      } else if (feature === 'reasoning') {
        useReasoning = false;
        capabilities.reasoningControlSupport = false;
      } else if (feature === 'vision') {
        visionFallback = true;
        capabilities.visionSupport = false;
      } else if (feature === 'tools') {
        useTools = false;
        toolFallback = true;
        capabilities.toolSupport = false;
      }
    }

    if (!response?.ok) throw new Error('Provider fallback budget exhausted.');
    if (multimodal && !visionFallback) capabilities.visionSupport = true;
    if (externalTools.length && useTools) capabilities.toolSupport = true;
    if (useReasoning) capabilities.reasoningControlSupport = true;
    if (usePromptCache) capabilities.promptCacheSupport = true;
    if (includeUsage) capabilities.streamUsageSupport = true;
    if (!response.body) throw new Error('Provider returned no response body.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let usage = null;
    let firstSignalAt = 0;
    let firstTextAt = 0;
    let firstToolAt = 0;
    const toolCallChunks = [];

    const consumeLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') return;
      let payload;
      try { payload = JSON.parse(data); } catch { return; }
      const delta = extractDelta(payload);
      const toolChanged = collectToolCallDeltas(payload, toolCallChunks);
      const now = Date.now();
      if (!firstSignalAt && (delta || toolChanged)) firstSignalAt = now;
      if (!firstTextAt && delta) firstTextAt = now;
      if (!firstToolAt && toolChanged) firstToolAt = now;
      if (delta) {
        fullText += delta;
        onDelta(delta);
      }
      const normalized = normalizeUsage(payload.usage);
      if (normalized) usage = normalized;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) consumeLine(line);
    }
    buffer += decoder.decode();
    if (buffer) consumeLine(buffer);

    const normalizedCalls = normalizeToolCalls(toolCallChunks);
    const successfulAttempt = attempts[attempts.length - 1] || null;
    const finalUsage = usage || estimateUsage(body.messages, fullText);
    return {
      text: fullText.trim(),
      toolCalls: normalizedCalls,
      usage: finalUsage,
      visionFallback,
      visionAccepted: multimodal && !visionFallback,
      toolFallback,
      toolsAccepted: externalTools.length > 0 && useTools,
      diagnostics: {
        requestCount: attempts.length,
        retries: Math.max(0, attempts.length - 1),
        attempts,
        firstSignalMs: firstSignalAt ? firstSignalAt - overallStarted : null,
        firstTextMs: firstTextAt ? firstTextAt - overallStarted : null,
        firstToolMs: firstToolAt ? firstToolAt - overallStarted : null,
        finalHeadersMs: successfulAttempt?.headersMs ?? null,
        streamUsageSupport: capabilities.streamUsageSupport,
        visionSupport: capabilities.visionSupport,
        toolSupport: capabilities.toolSupport,
        reasoningControlSupport: capabilities.reasoningControlSupport,
        promptCacheSupport: capabilities.promptCacheSupport,
        reasoningEffort: useReasoning ? selectedEffort : null,
        adaptiveReasoning: Boolean(adaptiveReasoning && modelCanAdapt),
        adaptiveEscalated: Boolean(adaptiveReasoning && selectedEffort && selectedEffort !== (requestedEffort || 'low')),
        adaptiveFromEffort: adaptiveReasoning && modelCanAdapt ? (requestedEffort || 'low') : null,
        adaptiveToEffort: adaptiveReasoning && modelCanAdapt ? selectedEffort || null : null,
        promptCacheKeyUsed: Boolean(usePromptCache && cacheKey),
        estimatedUsage: finalUsage.exact === false,
      },
    };
  }
}
