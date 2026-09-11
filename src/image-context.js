import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function safeGeneratedPath(publicDir, publicUrl) {
  const raw = String(publicUrl || '').trim();
  if (!raw.startsWith('/generated/')) throw new Error('Chỉ hỗ trợ ảnh local trong /generated/.');
  const relative = raw.replace(/^\/+/, '');
  const target = normalize(join(publicDir, relative));
  const generatedRoot = normalize(join(publicDir, 'generated'));
  const inGenerated = target === generatedRoot
    || target.startsWith(`${generatedRoot}/`)
    || target.startsWith(`${generatedRoot}\\`);
  if (!inGenerated) throw new Error('Đường dẫn ảnh không hợp lệ.');
  return target;
}

export async function localImageToDataUrl(publicDir, publicUrl, maxBytes = 8 * 1024 * 1024) {
  const target = safeGeneratedPath(publicDir, publicUrl);
  const mime = MIME_BY_EXT[extname(target).toLowerCase()];
  if (!mime) throw new Error('Định dạng ảnh không được hỗ trợ cho vision context.');
  const info = await stat(target);
  if (!info.isFile()) throw new Error('Attachment ảnh không phải file hợp lệ.');
  if (info.size > maxBytes) throw new Error(`Ảnh quá lớn để gửi cho AI (${Math.ceil(info.size / 1024 / 1024)} MB).`);
  const bytes = await readFile(target);
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

export function createImageContextResolver({ publicDir, maxImages = 1, maxBytes = 8 * 1024 * 1024 } = {}) {
  const imageLimit = Math.max(0, Number(maxImages) || 0);
  const byteLimit = Math.max(1024 * 1024, Number(maxBytes) || 8 * 1024 * 1024);

  return async function resolveImageContext(history = [], { afterIndex = -1 } = {}) {
    if (!imageLimit || !Array.isArray(history) || !history.length) return history;
    const cloned = history.map((item) => ({
      ...item,
      attachments: Array.isArray(item?.attachments)
        ? item.attachments.map((attachment) => ({ ...attachment }))
        : item?.attachments,
    }));

    const numericAfterIndex = Number(afterIndex);
    const startIndex = Number.isFinite(numericAfterIndex)
      ? Math.max(0, Math.min(cloned.length, Math.floor(numericAfterIndex) + 1))
      : 0;

    let remaining = imageLimit;
    for (let i = cloned.length - 1; i >= startIndex && remaining > 0; i -= 1) {
      const item = cloned[i];
      if (!Array.isArray(item.attachments)) continue;
      for (let j = item.attachments.length - 1; j >= 0 && remaining > 0; j -= 1) {
        const attachment = item.attachments[j];
        if (attachment?.type !== 'image' || !String(attachment.url || '').startsWith('/generated/')) continue;
        try {
          attachment.dataUrl = await localImageToDataUrl(publicDir, attachment.url, byteLimit);
          remaining -= 1;
        } catch (error) {
          attachment.visionError = error?.message || String(error);
        }
      }
    }
    return cloned;
  };
}
