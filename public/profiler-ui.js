const BREAKDOWN_LABELS = {
  systemAndPersona: 'System + persona',
  topicInstruction: 'Topic instruction',
  summary: 'Conversation summary',
  recentHistory: 'Recent history',
  memory: 'Long-term memory',
  privateContext: 'Private context',
  researchEvidence: 'Web evidence',
  toolSchemas: 'Tool schemas',
  other: 'Other steering',
};

function integer(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function ms(value) {
  const number = integer(value);
  return number == null ? '-' : `${number} ms`;
}

function tokens(value) {
  const number = integer(value);
  return number == null ? '-' : new Intl.NumberFormat('vi-VN').format(number);
}

function profilerText(payload) {
  const debug = payload?.debug || {};
  const calls = Array.isArray(debug.providerCalls) ? debug.providerCalls : [];
  const lastCall = calls[calls.length - 1] || null;
  const profile = lastCall?.inputProfile || null;
  if (!profile && !debug.totalMs && !calls.length) return '';

  const providerMs = calls.reduce((sum, call) => sum + (Number(call?.ms) || 0), 0);
  const lines = [
    'PERFORMANCE',
    `Turn total: ${ms(debug.totalMs)}`,
    `First token: ${ms(debug.firstTokenMs)}`,
    `Provider total: ${ms(providerMs)} (${calls.length} call${calls.length === 1 ? '' : 's'})`,
  ];

  if (lastCall) {
    lines.push(`Last headers: ${ms(lastCall.finalHeadersMs)}`);
    lines.push(`Last first text: ${ms(lastCall.firstTextMs)}`);
  }
  if (debug.research?.ms) lines.push(`Research: ${ms(debug.research.ms)}`);
  if (debug.summary?.ms) lines.push(`Summary: ${ms(debug.summary.ms)}`);

  if (profile) {
    lines.push('', 'TOKEN ANATOMY');
    const usageLabel = profile.usageExact ? 'exact provider usage' : 'estimated provider usage';
    lines.push(`Input: ${tokens(profile.reportedInputTokens)} (${usageLabel})`);
    lines.push(`Anatomy estimate: ~${tokens(profile.estimatedInputTokens)}`);
    if (profile.estimateDeltaTokens != null) {
      const delta = Number(profile.estimateDeltaTokens) || 0;
      lines.push(`Delta vs provider: ${delta >= 0 ? '+' : ''}${tokens(delta)}`);
    }
    for (const [key, label] of Object.entries(BREAKDOWN_LABELS)) {
      const value = Number(profile.breakdown?.[key] || 0);
      if (value > 0) lines.push(`- ${label}: ~${tokens(value)}`);
    }
    if (profile.imageCount) lines.push(`- Images: ${profile.imageCount} attachment(s), token cost not estimated`);
    if (calls.length > 1) lines.push('Note: anatomy above is the final provider request; turn usage may include earlier tool/private-context calls.');
  }

  return lines.join('\n');
}

function decorateInspector() {
  if (typeof document === 'undefined') return;
  for (const card of document.querySelectorAll('.lab-debug-card.focus')) {
    if (card.querySelector('.profiler-summary')) continue;
    const pre = card.querySelector('pre');
    if (!pre) continue;
    let payload;
    try { payload = JSON.parse(pre.textContent || '{}'); } catch { continue; }
    const text = profilerText(payload);
    if (!text) continue;
    const summary = document.createElement('pre');
    summary.className = 'profiler-summary';
    summary.textContent = text;
    card.insertBefore(summary, pre);
  }
}

if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  const observer = new MutationObserver(() => decorateInspector());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  decorateInspector();
}

export { profilerText };
