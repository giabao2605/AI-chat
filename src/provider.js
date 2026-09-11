function chatEndpoint(baseUrl) {
  const normalized = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!normalized) throw new Error('Provider base URL is missing.');
  if (/\/chat\/completions$/i.test(normalized)) return normalized;
  return `${normalized}/chat/completions`;
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
  if (!Array.isArray(chunks)) return;
  for (const chunk of chunks) {
    const index = Number.isInteger(chunk?.index) ? chunk.index : target.length;
    if (!target[index]) {
      target[index] = { index, id: '', type: 'function', function: { name: '', arguments: '' } };
    }
    const call = target[index];
    if (chunk?.id) call.id = String(chunk.id);
    if (chunk?.type) call.type = String(chunk.type);
    if (chunk?.function?.name) {
      const nameChunk = String(chunk.function.name);
      if (!call.function.name) call.function.name = nameChunk;
      else if (call.function.name !== nameChunk && !call.function.name.endsWith(nameChunk)) call.function.name += nameChunk;
    }
    if (chunk?.function?.arguments) call.function.arguments += String(chunk.function.arguments);
  }
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
    this.visionSupport = null;
    this.toolSupport = null;
    this.streamUsageSupport = null;
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

  async streamChat(options) {
    this.assertCircuit();
    const started = Date.now();
    try {
      const result = await this.#streamChat(options);
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
  }) {
    const providerMessages = normalizeMessagesForProvider(messages);
    const multimodal = hasImageInput(providerMessages);
    let visionFallback = multimodal && this.visionSupport === false;
    const requestedTools = Array.isArray(tools) ? tools.filter(Boolean) : [];
    let useTools = requestedTools.length > 0 && this.toolSupport !== false;
    let toolFallback = requestedTools.length > 0 && this.toolSupport === false;
    let requestCount = 0;

    const makeBody = () => ({
      model: this.model,
      messages: visionFallback ? toTextOnlyMessages(providerMessages) : providerMessages,
      stream: true,
      temperature,
      max_tokens: maxOutputTokens,
      ...(useTools ? { tools: requestedTools, tool_choice: toolChoice || 'auto' } : {}),
    });

    const doRequest = async (body, includeUsage) => {
      requestCount += 1;
      return requestStream({ endpoint: this.endpoint, apiKey: this.apiKey, body, signal, includeUsage, timeoutMs: this.timeoutMs });
    };

    let body = makeBody();
    let includeUsage = this.streamUsageSupport !== false;
    let response = await doRequest(body, includeUsage);

    if (!response.ok && includeUsage && [400, 404, 422].includes(response.status)) {
      const retry = await doRequest(body, false);
      if (retry.ok) this.streamUsageSupport = false;
      response = retry;
      includeUsage = false;
    } else if (response.ok && includeUsage) {
      this.streamUsageSupport = true;
    }

    if (!response.ok && multimodal && !visionFallback && [400, 404, 415, 422].includes(response.status)) {
      visionFallback = true;
      body = makeBody();
      response = await doRequest(body, false);
      if (response.ok) this.visionSupport = false;
    }

    if (!response.ok && useTools && [400, 404, 415, 422].includes(response.status)) {
      useTools = false;
      toolFallback = true;
      body = makeBody();
      response = await doRequest(body, false);
      if (response.ok) this.toolSupport = false;
    }

    if (!response.ok) {
      const errorText = (await response.text()).slice(0, 2000);
      throw new Error(`Provider returned HTTP ${response.status}: ${errorText || response.statusText}`);
    }

    if (multimodal && !visionFallback) this.visionSupport = true;
    if (requestedTools.length > 0 && useTools) this.toolSupport = true;
    if (!response.body) throw new Error('Provider returned no response body.');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let usage = null;
    const toolCallChunks = [];

    const consumeLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') return;
      let payload;
      try { payload = JSON.parse(data); } catch { return; }
      const delta = extractDelta(payload);
      if (delta) {
        fullText += delta;
        onDelta(delta);
      }
      collectToolCallDeltas(payload, toolCallChunks);
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

    return {
      text: fullText.trim(),
      toolCalls: normalizeToolCalls(toolCallChunks),
      usage: usage || estimateUsage(body.messages, fullText),
      visionFallback,
      visionAccepted: multimodal && !visionFallback,
      toolFallback,
      toolsAccepted: requestedTools.length > 0 && useTools,
      diagnostics: {
        requestCount,
        streamUsageSupport: this.streamUsageSupport,
        visionSupport: this.visionSupport,
        toolSupport: this.toolSupport,
      },
    };
  }
}
