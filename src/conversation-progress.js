export const PASS_REPLY = '{"action":"pass"}';
export const CONTRIBUTION_PROMPT = `Chỉ bổ sung một ý cụ thể chưa có, bằng chứng, sửa sai hoặc trả lời câu hỏi còn mở. Không diễn đạt lại kết luận cũ, khen xã giao, tóm tắt lại hay cố tạo bất đồng/câu hỏi để kéo dài. Nếu không còn đóng góp hữu ích, chỉ trả JSON {"action":"pass"} để bỏ lượt.`;

function words(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 2000);
}

function overlap(left, right) {
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared;
}

export function loopSimilarity(a, b) {
  const left = new Set(words(a));
  const right = new Set(words(b));
  const shared = overlap(left, right);
  return shared / (left.size + right.size - shared || 1);
}

function phrases(tokens) {
  return new Set(tokens.slice(0, -3).map((_, i) => tokens.slice(i, i + 4).join(' ')));
}

function repeatedText(text, previous, threshold) {
  const current = words(text);
  const old = words(previous);
  if (current.length >= 3 && current.join(' ').length >= 12 && current.join(' ') === old.join(' ')) return true;
  if (current.length < 8 || old.length < 8) return false;
  // Keep changed numbers and explicit corrections out of automatic suppression.
  const signals = value => [...new Set(String(value).toLowerCase().normalize('NFC')
    .match(/\d+(?:[.,]\d+)*|[\p{L}]+/gu)?.filter(token => /\d/.test(token)
      || /^(không|chưa|chẳng|khong|chua|chang|not|no|never)$/.test(token)) || [])].sort().join('|');
  if (signals(text) !== signals(previous)) return false;
  const currentPhrases = phrases(current);
  const phraseCoverage = overlap(currentPhrases, phrases(old)) / (currentPhrases.size || 1);
  // shortcut: lexical overlap misses semantic paraphrases; add semantic evaluation only with real failure traces.
  return loopSimilarity(text, previous) >= threshold || phraseCoverage >= 0.9;
}

export function recentAiMessages(history = [], agentIds = null) {
  const boundary = history.findLastIndex(item => item?.speaker === 'user' || item?.speaker === 'tool');
  return history.slice(boundary + 1).filter(item => agentIds?.length
    ? agentIds.includes(item?.speaker) : /^[a-z]$/.test(item?.speaker || '')).slice(-12);
}

export function isRepeatedReply(text, history, agentIds) {
  return recentAiMessages(history, agentIds).some(item => repeatedText(text, item.text, 0.88));
}

export function detectConversationLoop(history = [], threshold = 0.74, agentIds = null) {
  const ai = recentAiMessages(history, agentIds);
  return ai.slice(-4).filter((item, i) => {
    const index = Math.max(0, ai.length - 4) + i;
    return ai.slice(0, index).some(previous => repeatedText(item.text, previous.text, threshold));
  }).length >= 2;
}

export function isPassReply(text) {
  return typeof text === 'string' && text.length <= 128
    && /^\s*\{\s*"action"\s*:\s*"pass"\s*\}\s*$/.test(text);
}

// Hold only a possible control prefix; ordinary dialogue still streams immediately.
export function passStream(onDelta, enabled = true) {
  let pending = '';
  let checking = enabled;
  return {
    write(delta) {
      if (!checking) return onDelta(delta);
      pending += delta;
      if (pending.length <= 128 && PASS_REPLY.startsWith(pending.replace(/\s/g, ''))) return;
      checking = false;
      onDelta(pending);
      pending = '';
    },
    finish(passed) {
      if (pending && !passed) onDelta(pending);
      pending = '';
      checking = false;
    },
  };
}
