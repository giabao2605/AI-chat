import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

function safePrompt(value, maxLength = 2048) {
  return String(value || '').trim().slice(0, maxLength);
}

function abortSignal(parent, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

function extractCloudflareImage(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload?.result?.image === 'string') return payload.result.image;
  if (typeof payload?.result === 'string') return payload.result;
  if (typeof payload?.image === 'string') return payload.image;
  return '';
}

function cloudflareError(payload, response) {
  const first = Array.isArray(payload?.errors) ? payload.errors[0] : null;
  const detail = first?.message || payload?.message || response.statusText || `HTTP ${response.status}`;
  const code = first?.code ? ` (${first.code})` : '';
  return `Cloudflare Workers AI lỗi ${response.status}${code}: ${String(detail).slice(0, 1000)}`;
}

export class CloudflareImageTool {
  constructor({
    accountId,
    apiToken,
    model = '@cf/black-forest-labs/flux-1-schnell',
    timeoutMs = 120000,
    maxBytes = 25 * 1024 * 1024,
    outputDir,
    publicPrefix = '/generated',
    fetchImpl = fetch,
  } = {}) {
    this.accountId = String(accountId || '').trim();
    this.apiToken = String(apiToken || '').trim();
    this.model = String(model || '').trim();
    this.timeoutMs = Math.max(5000, Number(timeoutMs) || 120000);
    this.maxBytes = Math.max(1024 * 1024, Number(maxBytes) || 25 * 1024 * 1024);
    this.outputDir = String(outputDir || '').trim();
    this.publicPrefix = `/${String(publicPrefix || 'generated').replace(/^\/+|\/+$/g, '')}`;
    this.fetchImpl = fetchImpl;
  }

  endpoint() {
    if (!this.accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID chưa được cấu hình.');
    if (!this.model) throw new Error('IMAGE_GEN_MODEL chưa được cấu hình.');
    return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/ai/run/${this.model}`;
  }

  async generate(prompt, { signal } = {}) {
    const cleanedPrompt = safePrompt(prompt);
    if (!cleanedPrompt) throw new Error('Hãy nhập mô tả ảnh sau /img_gen.');
    if (!this.apiToken) throw new Error('CLOUDFLARE_API_TOKEN chưa được cấu hình.');
    if (!this.outputDir) throw new Error('Image output directory chưa được cấu hình.');

    const response = await this.fetchImpl(this.endpoint(), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiToken}`,
      },
      body: JSON.stringify({ prompt: cleanedPrompt }),
      signal: abortSignal(signal, this.timeoutMs),
    });

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    let bytes;
    let extension = '.jpg';

    if (contentType.startsWith('image/')) {
      bytes = Buffer.from(await response.arrayBuffer());
      extension = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
      if (!response.ok) throw new Error(`Cloudflare Workers AI lỗi ${response.status}: ${response.statusText || 'Không tạo được ảnh.'}`);
    } else {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success === false) throw new Error(cloudflareError(payload, response));
      const encoded = extractCloudflareImage(payload);
      if (!encoded) throw new Error('Cloudflare Workers AI không trả dữ liệu ảnh hợp lệ.');
      bytes = Buffer.from(encoded, 'base64');
    }

    if (!bytes?.length) throw new Error('Cloudflare Workers AI trả dữ liệu ảnh rỗng.');
    if (bytes.length > this.maxBytes) throw new Error(`Ảnh vượt giới hạn ${Math.round(this.maxBytes / 1024 / 1024)} MB.`);

    await mkdir(this.outputDir, { recursive: true });
    const fileName = `${Date.now()}-${randomUUID()}${extension}`;
    await writeFile(join(this.outputDir, fileName), bytes);

    return {
      type: 'image',
      url: `${this.publicPrefix}/${fileName}`,
      alt: cleanedPrompt,
      prompt: cleanedPrompt,
      revisedPrompt: '',
      size: 'provider-default',
      model: this.model,
      provider: 'cloudflare',
    };
  }
}

export { extractCloudflareImage };
