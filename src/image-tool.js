import { mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const MIME_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

function cleanBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function imageEndpoint(baseUrl, explicitEndpoint = '') {
  const explicit = String(explicitEndpoint || '').trim();
  if (explicit) return explicit;
  const normalized = cleanBaseUrl(baseUrl);
  if (!normalized) throw new Error('IMAGE_GEN_BASE_URL chưa được cấu hình.');
  if (/\/images\/generations$/i.test(normalized)) return normalized;
  return `${normalized}/images/generations`;
}

function safePrompt(value, maxLength = 12000) {
  return String(value || '').trim().slice(0, maxLength);
}

function extensionForMime(mimeType, fallbackUrl = '') {
  const normalized = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (MIME_EXTENSIONS[normalized]) return MIME_EXTENSIONS[normalized];
  try {
    const ext = extname(new URL(fallbackUrl).pathname).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  } catch {}
  return '.png';
}

function abortSignal(parent, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

async function readImageResponse(response, maxBytes) {
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error(`Image provider trả URL nhưng nội dung không phải ảnh (${contentType}).`);
  }
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Ảnh vượt giới hạn ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length) throw new Error('Image provider trả file ảnh rỗng.');
  if (buffer.length > maxBytes) throw new Error(`Ảnh vượt giới hạn ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  return { buffer, contentType };
}

function extractImagePayload(payload) {
  const row = Array.isArray(payload?.data) ? payload.data[0]
    : Array.isArray(payload?.images) ? payload.images[0]
      : null;
  if (!row || typeof row !== 'object') return null;
  return {
    base64: row.b64_json || row.base64 || row.image_base64 || '',
    url: row.url || row.image_url || '',
    revisedPrompt: row.revised_prompt || row.revisedPrompt || '',
  };
}

export class OpenAICompatibleImageTool {
  constructor({
    baseUrl,
    endpoint = '',
    apiKey,
    model,
    size = '1024x1024',
    timeoutMs = 120000,
    maxBytes = 25 * 1024 * 1024,
    outputDir,
    publicPrefix = '/generated',
    fetchImpl = fetch,
  } = {}) {
    this.endpoint = imageEndpoint(baseUrl, endpoint);
    this.apiKey = String(apiKey || '').trim();
    this.model = String(model || '').trim();
    this.size = String(size || '1024x1024').trim();
    this.timeoutMs = Math.max(5000, Number(timeoutMs) || 120000);
    this.maxBytes = Math.max(1024 * 1024, Number(maxBytes) || 25 * 1024 * 1024);
    this.outputDir = String(outputDir || '').trim();
    this.publicPrefix = `/${String(publicPrefix || 'generated').replace(/^\/+|\/+$/g, '')}`;
    this.fetchImpl = fetchImpl;
  }

  async generate(prompt, { signal } = {}) {
    const cleanedPrompt = safePrompt(prompt);
    if (!cleanedPrompt) throw new Error('Hãy nhập mô tả ảnh sau /img_gen.');
    if (!this.apiKey) throw new Error('IMAGE_GEN_API_KEY chưa được cấu hình.');
    if (!this.model) throw new Error('IMAGE_GEN_MODEL chưa được cấu hình.');
    if (!this.outputDir) throw new Error('Image output directory chưa được cấu hình.');

    const requestSignal = abortSignal(signal, this.timeoutMs);
    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        prompt: cleanedPrompt,
        size: this.size,
      }),
      signal: requestSignal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload?.error?.message || payload?.message || response.statusText || `HTTP ${response.status}`;
      throw new Error(`Image provider lỗi ${response.status}: ${String(detail).slice(0, 1000)}`);
    }

    const image = extractImagePayload(payload);
    if (!image) throw new Error('Image provider không trả dữ liệu ảnh hợp lệ.');

    let bytes;
    let extension = '.png';
    if (image.base64) {
      bytes = Buffer.from(String(image.base64), 'base64');
      if (!bytes.length) throw new Error('Image provider trả dữ liệu base64 rỗng.');
      if (bytes.length > this.maxBytes) throw new Error(`Ảnh vượt giới hạn ${Math.round(this.maxBytes / 1024 / 1024)} MB.`);
    } else if (image.url) {
      let parsed;
      try { parsed = new URL(String(image.url)); } catch { throw new Error('Image provider trả URL ảnh không hợp lệ.'); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Image provider trả URL ảnh không an toàn.');
      const download = await this.fetchImpl(parsed.toString(), { signal: abortSignal(signal, this.timeoutMs) });
      if (!download.ok) throw new Error(`Không tải được ảnh từ provider: HTTP ${download.status}.`);
      const result = await readImageResponse(download, this.maxBytes);
      bytes = result.buffer;
      extension = extensionForMime(result.contentType, parsed.toString());
    } else {
      throw new Error('Image provider không trả base64 hoặc URL ảnh.');
    }

    await mkdir(this.outputDir, { recursive: true });
    const fileName = `${Date.now()}-${randomUUID()}${extension}`;
    await writeFile(join(this.outputDir, fileName), bytes);

    return {
      type: 'image',
      url: `${this.publicPrefix}/${fileName}`,
      alt: cleanedPrompt,
      prompt: cleanedPrompt,
      revisedPrompt: safePrompt(image.revisedPrompt, 12000),
      size: this.size,
      model: this.model,
    };
  }
}

export { imageEndpoint, extractImagePayload };
