const QUERY_STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'to', 'of', 'for', 'with', 'on', 'in', 'is', 'are', 'be', 'this', 'that',
  'la', 'va', 'cua', 'cho', 'voi', 'cac', 'nhung', 'mot', 'nay', 'do', 'kia', 'thi', 'o', 'trong', 'di', 'nhe', 'nha',
  'toi', 'tao', 'minh', 'ban', 'may', 'tui', 'bon', 'dua', 'ca',
  'hello', 'hi', 'hey', 'chao', 'buoi', 'sang', 'trua', 'chieu',
  'ai', 'agent', 'luna', 'chat', 'conversation', 'tro', 'chuyen', 'phong', 'chu', 'de',
  'tiep', 'tuc',
]);

function cleanText(value, maxLength = 12000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeSearchText(value) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchTokens(value) {
  return new Set(normalizeSearchText(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !QUERY_STOPWORDS.has(token))
    .slice(0, 160));
}

function explicitRecallRequested(value) {
  const text = normalizeSearchText(value);
  if (!text) return false;
  return /\b(nho|remember|recall|previous|earlier)\b/.test(text)
    || /\b(lan|hom|phien|cuoc)\s+(truoc|cu)\b/.test(text)
    || /\btruoc\s+day\b/.test(text);
}

export function previewMemoryActivation(memory = {}, query = '') {
  const queryTokens = searchTokens(query);
  const contentTokens = searchTokens(`${memory.content || ''} ${memory.key || ''}`);
  let shared = 0;
  for (const token of queryTokens) if (contentTokens.has(token)) shared += 1;
  const relevance = queryTokens.size && contentTokens.size
    ? shared / Math.sqrt(queryTokens.size * contentTokens.size)
    : 0;
  const explicitRecall = explicitRecallRequested(query);
  const type = String(memory.type || '').toLowerCase();
  let activated = false;
  if (queryTokens.size && shared) {
    if (explicitRecall) activated = relevance >= 0.05;
    else if (type === 'semantic') activated = shared >= 1 && relevance >= 0.20;
    else if (type === 'relationship' || type === 'procedural') activated = shared >= 1 && relevance >= 0.18;
    else activated = shared >= 2 && relevance >= 0.18;
  }
  return {
    activated,
    relevance,
    sharedTokens: shared,
    queryTokens: queryTokens.size,
    explicitRecall,
  };
}

export function inspectAgentMemory(memoryManager, agentId, {
  roomId = 'default-room',
  query = '',
  includeInactive = false,
  type = '',
  limit = 250,
} = {}) {
  if (!memoryManager?.enabled) return { agentId, memories: [], stats: { total: 0, byType: {} } };
  const memories = memoryManager.list(agentId, {
    roomId,
    limit: Math.max(1, Math.min(500, Number(limit) || 250)),
    includeInactive: Boolean(includeInactive),
    type,
  }).map((memory) => ({
    ...memory,
    retrievalPreview: previewMemoryActivation(memory, query),
    forgottenRun: memoryManager.isRunForgotten?.(memory.runId) || false,
  }));
  return {
    agentId,
    stats: memoryManager.stats(agentId, { roomId }),
    memories,
  };
}

export function forgetMemoryRecord(memoryManager, agentId, memoryId, { roomId = 'default-room' } = {}) {
  if (!memoryManager?.enabled || !memoryManager.store?.db?.prepare) return 0;
  const cleanAgentId = cleanText(agentId, 80).toLowerCase();
  const cleanMemoryId = cleanText(memoryId, 240);
  const namespaces = memoryManager.namespaces(roomId);
  if (!cleanAgentId || !cleanMemoryId || !namespaces.length) return 0;
  const marks = namespaces.map(() => '?').join(', ');
  const result = memoryManager.store.db.prepare(`
    UPDATE agent_memories
    SET active = 0, updated_at = ?
    WHERE id = ? AND agent_id = ? AND namespace IN (${marks}) AND active = 1
  `).run(new Date().toISOString(), cleanMemoryId, cleanAgentId, ...namespaces);
  return Number(result?.changes || 0);
}

export function clearAgentMemory(memoryManager, agentId, { roomId = 'default-room', type = '' } = {}) {
  if (!memoryManager?.enabled) return 0;
  return memoryManager.clear(agentId, { roomId, type });
}
