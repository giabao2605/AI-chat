import { shuffled } from './scenario.js';

export const WEREWOLF_ROLES = Object.freeze({
  WEREWOLF: 'werewolf',
  SEER: 'seer',
  DOCTOR: 'doctor',
  VILLAGER: 'villager',
});

const VALID_ROLES = new Set(Object.values(WEREWOLF_ROLES));

const DEFAULT_COMPOSITIONS = Object.freeze({
  4: [WEREWOLF_ROLES.WEREWOLF, WEREWOLF_ROLES.SEER, WEREWOLF_ROLES.DOCTOR, WEREWOLF_ROLES.VILLAGER],
  5: [WEREWOLF_ROLES.WEREWOLF, WEREWOLF_ROLES.SEER, WEREWOLF_ROLES.DOCTOR, WEREWOLF_ROLES.VILLAGER, WEREWOLF_ROLES.VILLAGER],
  6: [WEREWOLF_ROLES.WEREWOLF, WEREWOLF_ROLES.WEREWOLF, WEREWOLF_ROLES.SEER, WEREWOLF_ROLES.DOCTOR, WEREWOLF_ROLES.VILLAGER, WEREWOLF_ROLES.VILLAGER],
});

function roleLabel(role) {
  return ({
    [WEREWOLF_ROLES.WEREWOLF]: 'Ma Sói',
    [WEREWOLF_ROLES.SEER]: 'Tiên Tri',
    [WEREWOLF_ROLES.DOCTOR]: 'Bác Sĩ',
    [WEREWOLF_ROLES.VILLAGER]: 'Dân Làng',
  })[role] || role;
}

function aliveIds(state) {
  return state.agentIds.filter((id) => state.alive[id]);
}

function deadIds(state) {
  return state.agentIds.filter((id) => !state.alive[id]);
}

function roleIds(state, role, { aliveOnly = false } = {}) {
  return state.agentIds.filter((id) => state.roles[id] === role && (!aliveOnly || state.alive[id]));
}

function cleanRoleAssignment(agentIds, options, rng) {
  const explicit = options?.rolesByAgent;
  if (explicit && typeof explicit === 'object') {
    const roles = {};
    for (const id of agentIds) {
      const role = String(explicit[id] || '').trim().toLowerCase();
      if (!VALID_ROLES.has(role)) throw new Error(`Role của agent ${id.toUpperCase()} không hợp lệ.`);
      roles[id] = role;
    }
    if (!Object.values(roles).includes(WEREWOLF_ROLES.WEREWOLF)) throw new Error('Werewolf scenario cần ít nhất một Ma Sói.');
    return roles;
  }

  const composition = DEFAULT_COMPOSITIONS[agentIds.length];
  if (!composition) throw new Error(`Chưa có role composition mặc định cho ${agentIds.length} agent.`);
  const shuffledAgents = shuffled(agentIds, rng);
  const shuffledRoles = shuffled(composition, rng);
  return Object.fromEntries(shuffledAgents.map((id, index) => [id, shuffledRoles[index]]));
}

function blankNight() {
  return {
    submitted: {},
    wolfVotes: {},
    seerTargets: {},
    doctorTargets: {},
  };
}

function addEvent(state, event) {
  state.events.push({ id: `e${state.nextEventId++}`, day: state.day, ...event });
  if (state.events.length > 80) state.events.splice(0, state.events.length - 80);
}

function specialNightRole(role) {
  return [WEREWOLF_ROLES.WEREWOLF, WEREWOLF_ROLES.SEER, WEREWOLF_ROLES.DOCTOR].includes(role);
}

function nightActionFor(state, agentId) {
  if (!state.alive[agentId] || state.night.submitted[agentId]) return [];
  const role = state.roles[agentId];
  const alive = aliveIds(state);
  if (role === WEREWOLF_ROLES.WEREWOLF) {
    const targets = alive.filter((id) => id !== agentId && state.roles[id] !== WEREWOLF_ROLES.WEREWOLF);
    return [...(targets.length ? [{ type: 'wolf_kill', targets }] : []), { type: 'pass' }];
  }
  if (role === WEREWOLF_ROLES.SEER) {
    const targets = alive.filter((id) => id !== agentId);
    return [...(targets.length ? [{ type: 'seer_inspect', targets }] : []), { type: 'pass' }];
  }
  if (role === WEREWOLF_ROLES.DOCTOR) {
    return [...(alive.length ? [{ type: 'doctor_protect', targets: alive }] : []), { type: 'pass' }];
  }
  return [];
}

function dayVoteActionFor(state, agentId) {
  if (!state.alive[agentId] || Object.prototype.hasOwnProperty.call(state.dayVotes, agentId)) return [];
  const targets = aliveIds(state).filter((id) => id !== agentId);
  return [...(targets.length ? [{ type: 'vote', targets }] : []), { type: 'pass' }];
}

function pendingNightActors(state) {
  return state.agentIds.filter((id) => state.alive[id]
    && specialNightRole(state.roles[id])
    && !state.night.submitted[id]);
}

function choosePlurality(state, values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) || 0) + 1);
  if (!counts.size) return null;
  let bestCount = -1;
  let winners = [];
  for (const [id, count] of counts.entries()) {
    if (count > bestCount) {
      bestCount = count;
      winners = [id];
    } else if (count === bestCount) winners.push(id);
  }
  return state.agentIds.find((id) => winners.includes(id)) || winners[0] || null;
}

function checkVictory(state) {
  const alive = aliveIds(state);
  const wolves = alive.filter((id) => state.roles[id] === WEREWOLF_ROLES.WEREWOLF).length;
  const nonWolves = alive.length - wolves;
  if (wolves === 0) state.winner = 'village';
  else if (wolves >= nonWolves) state.winner = 'wolves';
  else return false;
  state.phase = 'completed';
  addEvent(state, { type: 'victory', winner: state.winner });
  return true;
}

function resolveNight(state) {
  const wolfTarget = choosePlurality(state, Object.values(state.night.wolfVotes));
  const protectedTargets = new Set(Object.values(state.night.doctorTargets).filter(Boolean));
  if (wolfTarget && state.alive[wolfTarget] && !protectedTargets.has(wolfTarget)) {
    state.alive[wolfTarget] = false;
    addEvent(state, { type: 'night_death', agentId: wolfTarget });
  } else {
    addEvent(state, { type: 'night_safe' });
  }
  if (checkVictory(state)) return;
  state.phase = 'day_discussion';
  state.discussionSpoken = {};
  state.dayVotes = {};
  addEvent(state, { type: 'day_started' });
}

function resolveDayVote(state) {
  const counts = new Map();
  for (const target of Object.values(state.dayVotes).filter(Boolean)) counts.set(target, (counts.get(target) || 0) + 1);
  let eliminated = null;
  if (counts.size) {
    const highest = Math.max(...counts.values());
    const winners = [...counts.entries()].filter(([, count]) => count === highest).map(([id]) => id);
    if (winners.length === 1) eliminated = winners[0];
  }
  if (eliminated && state.alive[eliminated]) {
    state.alive[eliminated] = false;
    addEvent(state, { type: 'vote_elimination', agentId: eliminated });
  } else {
    addEvent(state, { type: 'vote_tie' });
  }
  if (checkVictory(state)) return;
  state.day += 1;
  state.phase = 'night';
  state.night = blankNight();
  state.discussionSpoken = {};
  state.dayVotes = {};
  addEvent(state, { type: 'night_started' });
}

export const WEREWOLF_SCENARIO = Object.freeze({
  id: 'werewolf',
  version: '1',
  minimumPlayers: 4,
  maximumPlayers: 6,
  conversationModes: ['turns'],

  initialize(agentIds, options = {}, rng = Math.random) {
    const roles = cleanRoleAssignment(agentIds, options, rng);
    const state = {
      phase: 'setup',
      day: 1,
      agentIds: [...agentIds],
      roles,
      alive: Object.fromEntries(agentIds.map((id) => [id, true])),
      night: blankNight(),
      discussionSpoken: {},
      dayVotes: {},
      inspections: Object.fromEntries(agentIds.map((id) => [id, []])),
      events: [],
      nextEventId: 1,
      winner: null,
    };
    addEvent(state, { type: 'game_started', playerCount: agentIds.length });
    return state;
  },

  publicState(state) {
    return {
      phase: state.phase,
      day: state.day,
      alive: aliveIds(state),
      dead: deadIds(state),
      events: state.events.slice(-30).map((event) => ({ ...event })),
      winner: state.winner,
    };
  },

  privateContextFor(state, agentId) {
    const role = state.roles[agentId];
    if (!role) return '';
    const lines = [
      `Vai trò bí mật của bạn: ${roleLabel(role)}.`,
      `Phase hiện tại: ${state.phase}. Ngày: ${state.day}.`,
    ];
    if (!state.alive[agentId]) lines.push('Bạn đã chết và không còn quyền nói hoặc hành động trong game.');
    if (role === WEREWOLF_ROLES.WEREWOLF) {
      const teammates = roleIds(state, WEREWOLF_ROLES.WEREWOLF).filter((id) => id !== agentId);
      lines.push(teammates.length ? `Đồng đội Ma Sói của bạn: ${teammates.map((id) => id.toUpperCase()).join(', ')}.` : 'Bạn là Ma Sói duy nhất.');
    }
    const inspections = state.inspections[agentId] || [];
    if (role === WEREWOLF_ROLES.SEER && inspections.length) {
      lines.push('Kết quả soi riêng của bạn:');
      for (const item of inspections) lines.push(`- Đêm ${item.day}: ${item.target.toUpperCase()} = ${item.isWolf ? 'Ma Sói' : 'không phải Ma Sói'}.`);
    }
    lines.push('Không tiết lộ block bí mật này như dữ liệu hệ thống. Bạn có thể nói dối, suy luận hoặc công khai thông tin theo chiến thuật game nếu muốn.');
    return lines.join('\n');
  },

  legalActionsFor(state, agentId) {
    if (state.phase === 'night') return nightActionFor(state, agentId);
    if (state.phase === 'day_vote') return dayVoteActionFor(state, agentId);
    return [];
  },

  eligibleSpeakers(state) {
    if (state.phase === 'night') return pendingNightActors(state);
    if (state.phase === 'day_discussion') return aliveIds(state).filter((id) => !state.discussionSpoken[id]);
    if (state.phase === 'day_vote') return aliveIds(state).filter((id) => !Object.prototype.hasOwnProperty.call(state.dayVotes, id));
    return [];
  },

  applyAction(state, agentId, action) {
    if (state.phase === 'night') {
      state.night.submitted[agentId] = true;
      if (action.type === 'wolf_kill') state.night.wolfVotes[agentId] = action.target;
      else if (action.type === 'seer_inspect') {
        state.night.seerTargets[agentId] = action.target;
        state.inspections[agentId].push({ day: state.day, target: action.target, isWolf: state.roles[action.target] === WEREWOLF_ROLES.WEREWOLF });
      } else if (action.type === 'doctor_protect') state.night.doctorTargets[agentId] = action.target;
      return { type: action.type };
    }
    if (state.phase === 'day_vote') {
      state.dayVotes[agentId] = action.type === 'vote' ? action.target : null;
      return { type: action.type };
    }
    throw new Error('Scenario action không hợp lệ ở phase hiện tại.');
  },

  onPublicMessage(state, agentId) {
    if (state.phase !== 'day_discussion' || !state.alive[agentId] || state.discussionSpoken[agentId]) return false;
    state.discussionSpoken[agentId] = true;
    return true;
  },

  maybeAdvancePhase(state) {
    if (state.phase === 'setup') {
      state.phase = 'night';
      state.night = blankNight();
      addEvent(state, { type: 'night_started' });
      return true;
    }
    if (state.phase === 'night' && pendingNightActors(state).length === 0) {
      state.phase = 'night_resolution';
      return true;
    }
    if (state.phase === 'night_resolution') {
      resolveNight(state);
      return true;
    }
    if (state.phase === 'day_discussion') {
      const alive = aliveIds(state);
      if (alive.length && alive.every((id) => state.discussionSpoken[id])) {
        state.phase = 'day_vote';
        state.dayVotes = {};
        addEvent(state, { type: 'day_vote_started' });
        return true;
      }
    }
    if (state.phase === 'day_vote' && aliveIds(state).every((id) => Object.prototype.hasOwnProperty.call(state.dayVotes, id))) {
      state.phase = 'day_resolution';
      return true;
    }
    if (state.phase === 'day_resolution') {
      resolveDayVote(state);
      return true;
    }
    return false;
  },

  isComplete(state) {
    return state.phase === 'completed' && Boolean(state.winner);
  },

  result(state) {
    return {
      winner: state.winner,
      day: state.day,
      alive: aliveIds(state),
      dead: deadIds(state),
      roles: { ...state.roles },
    };
  },
});
