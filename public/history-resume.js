const RESUMABLE_STATUSES = new Set(['completed', 'stopped', 'error']);
const ACTIVE_STATUSES = new Set(['starting', 'running', 'paused', 'pausing']);

export function countHistoryAiTurns(history = []) {
  return (Array.isArray(history) ? history : []).reduce(
    (count, item) => count + (item?.speaker === 'a' || item?.speaker === 'b' ? 1 : 0),
    0,
  );
}

export function getHistoryResumePlan(session, { requestedMaxTurns, liveStatus = 'idle' } = {}) {
  if (!session || typeof session !== 'object' || !RESUMABLE_STATUSES.has(session.status)) {
    return { canResume: false, reason: 'not-resumable', usedTurns: 0, maxTurns: 0, remainingTurns: 0 };
  }

  const usedTurns = countHistoryAiTurns(session.history);
  const savedMax = Math.max(1, Math.floor(Number(session.maxTurns) || 20));

  if (ACTIVE_STATUSES.has(liveStatus)) {
    return {
      canResume: false,
      reason: 'live-room-active',
      usedTurns,
      maxTurns: savedMax,
      remainingTurns: Math.max(0, savedMax - usedTurns),
    };
  }

  if (usedTurns < savedMax) {
    return {
      canResume: true,
      reason: 'within-original-cap',
      usedTurns,
      maxTurns: savedMax,
      remainingTurns: savedMax - usedTurns,
      extended: false,
    };
  }

  const requested = Math.max(1, Math.floor(Number(requestedMaxTurns) || savedMax));
  if (requested > usedTurns && requested > savedMax) {
    return {
      canResume: true,
      reason: 'cap-explicitly-extended',
      usedTurns,
      maxTurns: requested,
      remainingTurns: requested - usedTurns,
      extended: true,
    };
  }

  return {
    canResume: false,
    reason: 'limit-reached',
    usedTurns,
    maxTurns: savedMax,
    remainingTurns: 0,
    requiredMinTurns: usedTurns + 1,
  };
}
