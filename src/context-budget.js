import {
  classifyProviderMessage,
  countImageParts,
  estimateTokens,
  profileProviderInput,
  textFromContent,
} from './request-metrics.js';

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function messageCost(message, imageTokenReserve) {
  const textTokens = estimateTokens(`${String(message?.role || '')}:${textFromContent(message?.content)}`);
  const imageReserve = countImageParts(message?.content) * imageTokenReserve;
  return textTokens + imageReserve;
}

function profileWithReserve(messages, tools, imageTokenReserve) {
  const profile = profileProviderInput(messages, tools);
  const imageReserveTokens = profile.imageCount * imageTokenReserve;
  return {
    profile,
    imageReserveTokens,
    totalEstimatedTokens: profile.estimatedInputTokens + imageReserveTokens,
  };
}

export function applyContextBudget(messages = [], tools = [], {
  budgetTokens = 0,
  safetyMargin = 0.12,
  imageTokenReserve = 1500,
  minRecentMessages = 4,
} = {}) {
  const input = Array.isArray(messages) ? messages : [];
  const normalizedBudget = Math.max(0, Math.floor(Number(budgetTokens) || 0));
  const normalizedMargin = clamp(safetyMargin, 0, 0.5, 0.12);
  const normalizedImageReserve = Math.max(0, Math.floor(Number(imageTokenReserve) || 0));
  const normalizedMinRecent = Math.max(1, Math.floor(Number(minRecentMessages) || 4));
  const before = profileWithReserve(input, tools, normalizedImageReserve);

  if (!normalizedBudget) {
    return {
      messages: [...input],
      debug: {
        enabled: false,
        budgetTokens: 0,
        beforeEstimatedTokens: before.totalEstimatedTokens,
        afterEstimatedTokens: before.totalEstimatedTokens,
        dropped: [],
        overBudget: false,
      },
    };
  }

  const targetTokens = Math.max(1, Math.floor(normalizedBudget * (1 - normalizedMargin)));
  if (before.totalEstimatedTokens <= targetTokens) {
    return {
      messages: [...input],
      debug: {
        enabled: true,
        budgetTokens: normalizedBudget,
        targetTokens,
        safetyMargin: normalizedMargin,
        imageTokenReserve: normalizedImageReserve,
        beforeEstimatedTokens: before.totalEstimatedTokens,
        afterEstimatedTokens: before.totalEstimatedTokens,
        dropped: [],
        overBudget: false,
      },
    };
  }

  const entries = input.map((message, index) => ({
    index,
    message,
    category: classifyProviderMessage(message),
    cost: messageCost(message, normalizedImageReserve),
    protected: false,
  }));

  for (const entry of entries) {
    if (entry.message?.role === 'system' || entry.category === 'topicInstruction') entry.protected = true;
  }

  const recent = entries.filter((entry) => entry.category === 'recentHistory');
  for (const entry of recent.slice(-normalizedMinRecent)) entry.protected = true;
  if (entries.length) entries[entries.length - 1].protected = true;

  const categoryRank = {
    recentHistory: 0,
    summary: 1,
    memory: 2,
    other: 3,
    researchEvidence: 4,
    privateContext: 5,
  };
  const candidates = entries
    .filter((entry) => !entry.protected && Object.hasOwn(categoryRank, entry.category))
    .sort((a, b) => {
      const rank = categoryRank[a.category] - categoryRank[b.category];
      if (rank !== 0) return rank;
      return a.index - b.index;
    });

  let current = before.totalEstimatedTokens;
  const droppedIndexes = new Set();
  const dropped = [];
  for (const candidate of candidates) {
    if (current <= targetTokens) break;
    droppedIndexes.add(candidate.index);
    current = Math.max(0, current - candidate.cost);
    dropped.push({
      category: candidate.category,
      index: candidate.index,
      estimatedTokens: candidate.cost,
    });
  }

  const selected = entries.filter((entry) => !droppedIndexes.has(entry.index)).map((entry) => entry.message);
  const after = profileWithReserve(selected, tools, normalizedImageReserve);

  return {
    messages: selected,
    debug: {
      enabled: true,
      budgetTokens: normalizedBudget,
      targetTokens,
      safetyMargin: normalizedMargin,
      imageTokenReserve: normalizedImageReserve,
      beforeEstimatedTokens: before.totalEstimatedTokens,
      afterEstimatedTokens: after.totalEstimatedTokens,
      dropped,
      droppedCount: dropped.length,
      overBudget: after.totalEstimatedTokens > targetTokens,
      mandatoryExceeded: after.totalEstimatedTokens > targetTokens && candidates.length === dropped.length,
    },
  };
}
