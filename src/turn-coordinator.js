export class TurnCoordinator {
  firstSpeaker({ baseOrder = [], eligibleIds = baseOrder, requested = 'random', randomize = true, random = Math.random } = {}) {
    const order = Array.isArray(baseOrder) ? baseOrder : [];
    const eligible = new Set(Array.isArray(eligibleIds) ? eligibleIds : order);
    const candidates = order.filter((id) => eligible.has(id));
    if (!candidates.length) return null;
    if (requested && requested !== 'random' && eligible.has(requested)) return requested;
    if (!randomize) return candidates[0];
    const index = Math.max(0, Math.min(candidates.length - 1, Math.floor(Number(random?.()) * candidates.length) || 0));
    return candidates[index] || candidates[0];
  }

  nextSpeaker({ baseOrder = [], eligibleIds = baseOrder, current = null } = {}) {
    const order = Array.isArray(baseOrder) ? baseOrder : [];
    if (!order.length) return null;
    const eligible = new Set(Array.isArray(eligibleIds) ? eligibleIds : order);
    if (!eligible.size) return null;
    const index = Math.max(-1, order.indexOf(current));
    for (let offset = 1; offset <= order.length; offset += 1) {
      const candidate = order[(index + offset + order.length) % order.length];
      if (eligible.has(candidate)) return candidate;
    }
    return null;
  }

  unseenTrigger({ history = [], relevant, seenIds = null, lastSeenIndex = -1 } = {}) {
    if (typeof relevant !== 'function') return false;
    if (seenIds instanceof Set) {
      return history.some((item) => item?.id && !seenIds.has(item.id) && relevant(item));
    }
    const start = Math.max(0, (Number(lastSeenIndex) || -1) + 1);
    for (let index = start; index < history.length; index += 1) {
      if (relevant(history[index])) return true;
    }
    return false;
  }

  rotatedOrder(baseOrder = [], cursor = 0) {
    const order = Array.isArray(baseOrder) ? baseOrder : [];
    if (!order.length) return { order: [], nextCursor: 0 };
    const shift = ((Number(cursor) || 0) % order.length + order.length) % order.length;
    return {
      order: [...order.slice(shift), ...order.slice(0, shift)],
      nextCursor: (shift + 1) % order.length,
    };
  }

  availableParallelSlots({ maxTurns = 0, turn = 0, reservedTurns = 0 } = {}) {
    return Math.max(0, Number(maxTurns) - Number(turn) - Number(reservedTurns));
  }

  canStartParallel({
    isParallel = false,
    status = '',
    runtime = null,
    availableSlots = 0,
    initial = false,
    historyEmpty = false,
    hasUnseenTrigger = false,
  } = {}) {
    if (!isParallel || status !== 'running') return false;
    if (!runtime || runtime.running || runtime.parallelReserved) return false;
    if (Number(availableSlots) <= 0) return false;
    if (initial && historyEmpty) return true;
    return Boolean(hasUnseenTrigger);
  }

  limitReached({ status = '', turn = 0, maxTurns = 0, runningCount = 0, reservedTurns = 0 } = {}) {
    return status === 'running'
      && Number(turn) >= Number(maxTurns)
      && Number(runningCount) <= 0
      && Number(reservedTurns) <= 0;
  }
}
