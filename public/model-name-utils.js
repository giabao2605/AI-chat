export function modelFamily(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  if (/\b(chatgpt|gpt)\b/.test(text) || /gpt[-_ ]?\d/.test(text) || text.includes('luna')) return 'gpt';
  if (text.includes('claude') || text.includes('opus') || text.includes('sonnet') || text.includes('haiku')) return 'claude';
  if (text.includes('gemini')) return 'gemini';
  if (text.includes('llama')) return 'llama';
  if (text.includes('mistral')) return 'mistral';
  if (text.includes('qwen')) return 'qwen';
  return '';
}

export function looksLikeModelLabel(value) {
  const text = String(value || '').trim();
  if (!text) return false;
  return Boolean(modelFamily(text)) || /\b\d+(?:\.\d+)+\b/.test(text);
}

export function prettyModelName(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let text = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  text = text.replace(/^chatgpt\b/i, 'ChatGPT').replace(/^gpt\b/i, 'GPT');
  text = text.replace(/\bluna\b/gi, 'Luna').replace(/\bclaude\b/gi, 'Claude').replace(/\bopus\b/gi, 'Opus').replace(/\bsonnet\b/gi, 'Sonnet');
  return text;
}

export function resolveAgentDisplayName(agent = {}, savedName = '') {
  const model = String(agent.model || '').trim();
  const configName = String(agent.name || '').trim();
  const saved = String(savedName || '').trim();
  const modelName = prettyModelName(model);
  const modelKind = modelFamily(model);

  if (saved) {
    const savedKind = modelFamily(saved);
    if (!(looksLikeModelLabel(saved) && modelKind && savedKind && savedKind !== modelKind)) return saved;
  }

  if (configName) {
    const configKind = modelFamily(configName);
    if (!(looksLikeModelLabel(configName) && modelKind && configKind && configKind !== modelKind)) return configName;
  }

  return modelName || configName || saved || '';
}
