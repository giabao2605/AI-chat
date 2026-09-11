export const IMAGE_COMMAND = '/img_gen';

export function parseImageCommand(value) {
  const raw = String(value || '').trim();
  if (!/^\/img_gen(?:\s|$)/i.test(raw)) return { matched: false, prompt: '' };
  return {
    matched: true,
    prompt: raw.replace(/^\/img_gen\s*/i, '').trim(),
  };
}

export function shouldSuggestImageCommand(value) {
  const raw = String(value || '').trimStart();
  if (!raw.startsWith('/')) return false;
  if (/^\/img_gen\s+/i.test(raw)) return false;
  const normalized = raw.toLowerCase();
  return IMAGE_COMMAND.startsWith(normalized) || normalized.startsWith(IMAGE_COMMAND);
}
