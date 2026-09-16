import { applyContextBudget } from './context-budget.js';

function cloneMessages(messages) {
  return Array.isArray(messages) ? [...messages] : [];
}

function normalizedBudgetConfig(value = {}) {
  return {
    budgetTokens: Math.max(0, Number(value.budgetTokens) || 0),
    safetyMargin: Number.isFinite(Number(value.safetyMargin)) ? Number(value.safetyMargin) : 0.12,
    imageTokenReserve: Math.max(0, Number(value.imageTokenReserve) || 1500),
    minRecentMessages: Math.max(1, Number(value.minRecentMessages) || 4),
    agentBudgets: value.agentBudgets && typeof value.agentBudgets === 'object' ? { ...value.agentBudgets } : {},
  };
}

export class ContextAssembler {
  constructor({ budgetConfig = {} } = {}) {
    this.budgetConfig = normalizedBudgetConfig(budgetConfig);
  }

  setBudgetConfig(value = {}) {
    this.budgetConfig = normalizedBudgetConfig(value);
    return this.budgetConfig;
  }

  addMemoryContext(messages, content) {
    if (!content) return cloneMessages(messages);
    const next = cloneMessages(messages);
    let index = 0;
    while (index < next.length && next[index]?.role === 'system') index += 1;
    next.splice(index, 0, { role: 'user', content });
    return next;
  }

  addPrivateContext(messages, content) {
    if (!content) return cloneMessages(messages);
    const next = cloneMessages(messages);
    let firstNonSystem = 0;
    while (firstNonSystem < next.length && next[firstNonSystem]?.role === 'system') firstNonSystem += 1;
    const index = next.length > firstNonSystem ? Math.max(firstNonSystem, next.length - 1) : next.length;
    next.splice(index, 0, { role: 'user', content });
    return next;
  }

  addScenarioContext(messages, { publicBlock = '', privateBlock = '' } = {}) {
    const next = cloneMessages(messages);
    const blocks = [publicBlock, privateBlock]
      .filter(Boolean)
      .map((content) => ({ role: 'system', content }));
    if (!blocks.length) return next;
    const index = next.length ? 1 : 0;
    next.splice(index, 0, ...blocks);
    return next;
  }

  applyBudget(messages, tools, { agentId = '', budgetConfig = null } = {}) {
    const config = budgetConfig ? normalizedBudgetConfig(budgetConfig) : this.budgetConfig;
    const budgetTokens = Math.max(0, Number(config.agentBudgets?.[agentId]) || config.budgetTokens || 0);
    return applyContextBudget(messages, tools, {
      budgetTokens,
      safetyMargin: config.safetyMargin,
      imageTokenReserve: config.imageTokenReserve,
      minRecentMessages: config.minRecentMessages,
    });
  }
}
