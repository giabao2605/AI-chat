export const IMAGE_TOOL_NAME = 'generate_image';
export const PRIVATE_CONTEXT_TOOL_NAME = 'send_private_context';

export const IMAGE_GENERATION_TOOL = {
  type: 'function',
  function: {
    name: IMAGE_TOOL_NAME,
    description: 'Tạo ảnh mới trong cuộc trò chuyện khi người dùng yêu cầu hoặc khi hình ảnh thực sự hữu ích. Ảnh sẽ được đưa lại vào context để bạn xem. Không gọi tool vô ích hoặc lặp lại.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Mô tả tự chứa về ảnh cần tạo, gồm chủ thể, bối cảnh và chi tiết quan trọng.',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
};

export const PRIVATE_CONTEXT_TOOL = {
  type: 'function',
  function: {
    name: PRIVATE_CONTEXT_TOOL_NAME,
    description: 'Gửi một mẩu context bí mật cho một AI khác trong cùng phòng. Nội dung không được đưa vào transcript chung và chỉ sender + recipient của từng lần gửi được nhận lại trong context riêng. Bạn CÓ THỂ gọi tool nhiều lần trong cùng một response để gửi riêng cho nhiều AI khác nhau (1→nhiều); nhiều AI cũng có thể độc lập gửi tới cùng một recipient (nhiều→1). Mỗi call vẫn có đúng một recipient để bảo toàn isolation. Đây không phải bước bắt buộc trước khi trả lời. Nếu bạn đã biết câu trả lời công khai ngay lúc gửi private context, hãy đặt luôn câu trả lời hoàn chỉnh vào public_reply để backend có thể hoàn tất lượt trong cùng một model pass thay vì gọi model lần nữa.',
    parameters: {
      type: 'object',
      properties: {
        recipient: {
          type: 'string',
          description: 'ID của đúng một agent nhận context ở call này, ví dụ a, b, c hoặc d. Muốn gửi tới nhiều agent, tạo nhiều send_private_context calls trong cùng response, mỗi call chọn một recipient khác.',
        },
        content: {
          type: 'string',
          description: 'Nội dung bí mật cần truyền. Viết đủ ngữ cảnh để recipient hiểu nhưng không đưa nội dung này vào câu trả lời công khai.',
        },
        public_reply: {
          type: 'string',
          description: 'Tùy chọn. Câu trả lời công khai hoàn chỉnh của bạn cho lượt hiện tại nếu bạn đã có thể trả lời ngay. Dùng trường này để tránh một provider round-trip thứ hai sau khi private context được giao. Nếu cần chờ kết quả của tool khác trước khi trả lời thì bỏ trống.',
        },
      },
      required: ['recipient', 'content'],
      additionalProperties: false,
    },
  },
};

export function parseImageToolCall(call, maxPromptLength = 2048) {
  if (String(call?.function?.name || '') !== IMAGE_TOOL_NAME) return null;
  let args;
  try {
    args = JSON.parse(String(call?.function?.arguments || '{}'));
  } catch {
    return { prompt: '', error: 'Tool generate_image nhận arguments JSON không hợp lệ.' };
  }
  const prompt = String(args?.prompt || '').trim().slice(0, Math.max(1, maxPromptLength));
  if (!prompt) return { prompt: '', error: 'Tool generate_image thiếu prompt.' };
  return { prompt, error: '' };
}

export function parsePrivateContextToolCall(call, {
  allowedRecipients = [],
  senderId = '',
  maxContentLength = 8000,
  maxPublicReplyLength = 20000,
} = {}) {
  if (String(call?.function?.name || '') !== PRIVATE_CONTEXT_TOOL_NAME) return null;
  let args;
  try {
    args = JSON.parse(String(call?.function?.arguments || '{}'));
  } catch {
    return { recipient: '', content: '', publicReply: '', error: 'Tool send_private_context nhận arguments JSON không hợp lệ.' };
  }

  const recipient = String(args?.recipient || '').trim().toLowerCase().slice(0, 80);
  const content = String(args?.content || '').trim().slice(0, Math.max(1, Number(maxContentLength) || 8000));
  const publicReply = String(args?.public_reply || '').trim().slice(0, Math.max(1, Number(maxPublicReplyLength) || 20000));
  const allowed = new Set((Array.isArray(allowedRecipients) ? allowedRecipients : []).map((id) => String(id).toLowerCase()));
  const sender = String(senderId || '').toLowerCase();

  if (!recipient) return { recipient: '', content: '', publicReply, error: 'Tool send_private_context thiếu recipient.' };
  if (sender && recipient === sender) return { recipient, content: '', publicReply, error: 'Không thể gửi private context cho chính mình.' };
  if (allowed.size && !allowed.has(recipient)) return { recipient, content: '', publicReply, error: `Agent nhận '${recipient}' không tồn tại trong phòng.` };
  if (!content) return { recipient, content: '', publicReply, error: 'Tool send_private_context thiếu content.' };
  return { recipient, content, publicReply, error: '' };
}
