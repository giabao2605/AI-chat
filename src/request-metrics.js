function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  return content.map((part) => {
    if (typeof part === 'string') return part;
    if (part?.type === 'text') return String(part.text || '');
    if (part?.type === 'image_url') return '[image]';
    return '';
  }).filter(Boolean).join('\n');
}

export function estimateTokens(text) {
  const chars = String(text || '').length;
  return chars === 0 ? 0 : Math.max(1, Math.ceil(chars / 4));
}

function categoryForMessage(message) {
  const text = textFromContent(message?.content);
  if (message?.role === 'system') return 'systemAndPersona';
  if (text.includes('<agent_memory>')) return 'memory';
  if (text.includes('<private_agent_context>')) return 'privateContext';
  if (text.includes('<untrusted_web_evidence>')) return 'researchEvidence';
  if (text.includes('<conversation_summary>') || text.includes('<recent_context_digest>')) return 'summary';
  if (text.startsWith('Chủ đề của phòng trò chuyện:')) return 'topicInstruction';
  if (text.includes('<conversation_steering>') || text.includes('<tool_status>') || text.includes('<private_context_tool_result>')) return 'other';
  return 'recentHistory';
}

function imageCount(content) {
  if (!Array.isArray(content)) return 0;
  return content.filter((part) => part?.type === 'image_url').length;
}

export function profileProviderInput(messages = [], tools = []) {
  const breakdown = {
    systemAndPersona: 0,
    topicInstruction: 0,
    summary: 0,
    recentHistory: 0,
    memory: 0,
    privateContext: 0,
    researchEvidence: 0,
    toolSchemas: 0,
    other: 0,
  };
  let images = 0;
  let messageCount = 0;

  for (const message of Array.isArray(messages) ? messages : []) {
    const category = categoryForMessage(message);
    const text = `${String(message?.role || '')}:${textFromContent(message?.content)}`;
    breakdown[category] += estimateTokens(text);
    images += imageCount(message?.content);
    messageCount += 1;
  }

  if (Array.isArray(tools) && tools.length) breakdown.toolSchemas = estimateTokens(JSON.stringify(tools));
  const estimatedInputTokens = Object.values(breakdown).reduce((sum, value) => sum + value, 0);

  return {
    version: 1,
    estimatedInputTokens,
    breakdown,
    messageCount,
    imageCount: images,
    toolCount: Array.isArray(tools) ? tools.length : 0,
  };
}

export function finalizeProviderInputProfile(profile, usage) {
  const base = profile && typeof profile === 'object' ? profile : profileProviderInput();
  const reported = Number(usage?.inputTokens);
  const usageExact = usage?.exact !== false && Number.isFinite(reported);
  return {
    ...base,
    reportedInputTokens: Number.isFinite(reported) ? reported : null,
    usageExact,
    estimateDeltaTokens: usageExact ? reported - Number(base.estimatedInputTokens || 0) : null,
  };
}
