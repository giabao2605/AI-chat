import { IMAGE_GENERATION_TOOL, parseImageToolCall } from './agent-tools.js';

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

function safeText(value, maxLength = 100000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export class AgentExecutor {
  async execute({
    agentId,
    agentName,
    messageId,
    provider,
    messages,
    temperature,
    maxOutputTokens,
    signal,
    isActive = () => true,
    emit = () => {},
    imageTool = null,
    maxImageCalls = 0,
    recordImageToolEntry = null,
    appendImageToolEntry = null,
    onVisionFallback = null,
    onToolFallback = null,
  } = {}) {
    if (!provider?.streamChat) throw new Error(`Provider của ${agentName || agentId || 'agent'} không khả dụng.`);
    const workingMessages = Array.isArray(messages) ? messages : [];
    let messageStarted = false;
    let firstTokenAt = 0;
    let imageCallsUsed = 0;
    let turnUsage = null;
    let finalResult = null;
    const textParts = [];
    const providerDiagnostics = [];

    const onDelta = (delta) => {
      if (!isActive()) return;
      if (!messageStarted) {
        messageStarted = true;
        firstTokenAt = Date.now();
        emit('message:start', { id: messageId, speaker: agentId, name: agentName });
      }
      emit('message:delta', { id: messageId, speaker: agentId, delta });
    };

    while (isActive()) {
      const canUseImageTool = Boolean(imageTool?.generate)
        && imageCallsUsed < Math.max(0, Number(maxImageCalls) || 0);
      let result;
      try {
        const callStarted = Date.now();
        result = await provider.streamChat({
          messages: workingMessages,
          temperature,
          maxOutputTokens,
          signal,
          onDelta,
          tools: canUseImageTool ? [IMAGE_GENERATION_TOOL] : [],
          toolChoice: 'auto',
        });
        providerDiagnostics.push({ ms: Date.now() - callStarted, ...(result?.diagnostics || {}) });
      } catch (error) {
        if (error?.name === 'AbortError' || !isActive()) {
          if (messageStarted) emit('message:cancelled', { id: messageId, speaker: agentId });
        } else if (messageStarted) {
          emit('message:failed', { id: messageId, speaker: agentId, message: error?.message || String(error) });
        }
        throw error;
      }

      turnUsage = mergeUsage(turnUsage, result?.usage);
      if (result?.text) textParts.push(result.text);
      if (result?.visionFallback) onVisionFallback?.();
      if (result?.toolFallback && canUseImageTool) onToolFallback?.();

      const toolCalls = canUseImageTool ? (result?.toolCalls || []) : [];
      if (!toolCalls.length) {
        finalResult = result;
        break;
      }
      const selectedCalls = toolCalls.slice(0, Math.max(0, Number(maxImageCalls) || 0) - imageCallsUsed);
      if (!selectedCalls.length) {
        finalResult = result;
        break;
      }

      for (const call of selectedCalls) {
        imageCallsUsed += 1;
        const parsed = parseImageToolCall(call);
        if (!parsed) continue;
        let entry = null;
        if (parsed.error) {
          entry = await recordImageToolEntry?.({ prompt: '(prompt không hợp lệ)', attachment: null, errorMessage: parsed.error });
        } else {
          emit('meta', { text: `${agentName} đang dùng tool tạo ảnh...` });
          try {
            const attachment = await imageTool.generate(parsed.prompt, { signal });
            entry = await recordImageToolEntry?.({ prompt: parsed.prompt, attachment, errorMessage: '' });
          } catch (error) {
            if (error?.name === 'AbortError' || signal?.aborted || !isActive()) throw error;
            entry = await recordImageToolEntry?.({ prompt: parsed.prompt, attachment: null, errorMessage: error?.message || String(error) });
          }
        }
        if (!isActive()) return null;
        if (entry) await appendImageToolEntry?.(workingMessages, entry);
      }
    }

    if (!isActive()) return null;
    const text = safeText(textParts.join('\n\n'));
    if (!text) throw new Error(`${agentName || agentId} trả về nội dung rỗng.`);
    if (!messageStarted) {
      messageStarted = true;
      firstTokenAt = Date.now();
      emit('message:start', { id: messageId, speaker: agentId, name: agentName });
      emit('message:delta', { id: messageId, speaker: agentId, delta: text });
    }

    return {
      text,
      usage: turnUsage || finalResult?.usage || null,
      finalResult,
      providerDiagnostics,
      imageCallsUsed,
      messageStarted,
      firstTokenAt,
    };
  }
}
