export const IMAGE_TOOL_NAME = 'generate_image';

export const IMAGE_GENERATION_TOOL = {
  type: 'function',
  function: {
    name: IMAGE_TOOL_NAME,
    description: 'Tạo một ảnh mới và chèn ảnh đó trực tiếp vào cuộc trò chuyện. Bạn có thể chủ động dùng tool khi người dùng hoặc AI kia yêu cầu tạo ảnh, hoặc khi một hình minh họa thực sự giúp cuộc trò chuyện rõ ràng/thú vị hơn. Sau khi tool chạy, ảnh thật sẽ được đưa lại vào context để bạn có thể quan sát và tiếp tục trả lời. Không dùng chỉ để trang trí hoặc tạo lặp lại vô ích.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Mô tả đầy đủ ảnh cần tạo. Viết prompt tự chứa đủ chủ thể, bối cảnh, phong cách và chi tiết quan trọng.',
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
