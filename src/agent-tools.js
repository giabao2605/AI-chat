export const IMAGE_TOOL_NAME = 'generate_image';

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
