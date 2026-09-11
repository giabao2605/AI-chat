function safeText(value, maxLength = 6000) {
  return String(value ?? '').trim().slice(0, maxLength);
}

export function parseConversationEndDecision(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return { end: false, reason: 'invalid-decision' };
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1));
    return {
      end: parsed.end === true,
      reason: safeText(parsed.reason, 400),
    };
  } catch {
    return { end: false, reason: 'invalid-decision' };
  }
}

export function explicitStopRequested(history = []) {
  const latestUser = [...history].reverse().find((item) => item?.speaker === 'user');
  const text = safeText(latestUser?.text, 1200);
  if (!text) return false;

  if (/(?:đừng|không|chưa)\s+(?:dừng|ngừng|kết thúc)|(?:do not|don't|dont)\s+(?:stop|end)/i.test(text)) return false;

  return /(?:^|[\s,.!?])(dừng|ngừng|kết thúc)(?:\s+(?:đi|lại|nhé|nha|phiên|cuộc trò chuyện|nói chuyện))?(?:$|[\s,.!?])|(?:tới|đến)\s+đây\s+(?:thôi|là được)|\bđủ\s+rồi\b|\b(?:stop|end)\s+(?:the\s+)?(?:chat|conversation|session)\b/i.test(text);
}

function countAiMessages(history) {
  return history.filter((item) => item?.speaker === 'a' || item?.speaker === 'b').length;
}

export async function decideConversationEnd({ provider, topic, history = [], agentId, agentName = 'AI', signal } = {}) {
  // If a user message arrived after this agent finished, leave it for the next agent to answer.
  if (history.at(-1)?.speaker !== agentId) {
    return { end: false, reason: 'new-message-pending', usage: null };
  }

  // An explicit human stop request is deterministic: the first agent that answers it ends the room.
  if (explicitStopRequested(history)) {
    return { end: true, reason: 'Người dùng yêu cầu kết thúc cuộc trò chuyện.', usage: null };
  }

  // Avoid premature endings while the agents are still opening the discussion.
  if (countAiMessages(history) < 3) {
    return { end: false, reason: 'conversation-still-opening', usage: null };
  }

  const transcript = history.slice(-10).map((item) => `${item.name || item.speaker}: ${safeText(item.text, 1800)}`).join('\n');
  const messages = [
    {
      role: 'system',
      content: `Bạn là bộ quyết định kết thúc phiên cho một cuộc trò chuyện giữa hai AI. Hãy đánh giá liệu ${agentName} vừa nói xong có nên CHỦ ĐỘNG kết thúc toàn bộ phiên hay không.

Chỉ end=true khi cuộc thảo luận thực sự đã tới hồi kết: hai bên đã hội tụ/kết luận, không còn câu hỏi quan trọng chưa giải quyết, và một lượt luân phiên nữa chủ yếu sẽ lặp lại hoặc xã giao.

Phải end=false nếu còn góc nhìn mới đáng bàn, còn câu hỏi/mâu thuẫn chưa xử lý, đang brainstorm, chơi game, kể chuyện, giả lập, hoặc chỉ vì một câu trả lời vừa có giọng văn kết luận. Hãy bảo thủ: nghi ngờ thì tiếp tục.

CHỈ trả JSON hợp lệ đúng dạng:
{"end":true|false,"reason":"lý do ngắn gọn"}`,
    },
    {
      role: 'user',
      content: `Chủ đề: ${safeText(topic, 1400)}\n\nTranscript gần nhất:\n${transcript}`,
    },
  ];

  try {
    const result = await provider.streamChat({
      messages,
      temperature: 0,
      maxOutputTokens: 160,
      signal,
      onDelta: () => {},
    });
    const decision = parseConversationEndDecision(result.text);
    return { ...decision, usage: result.usage };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { end: false, reason: 'decision-error', usage: null, decisionError: error?.message || String(error) };
  }
}
