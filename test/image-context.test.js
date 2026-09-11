import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createImageContextResolver, localImageToDataUrl } from '../src/image-context.js';

const ONE_PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64');

test('image context resolver hydrates only the latest configured generated image', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ai-chat-vision-'));
  const generated = join(root, 'generated');
  await mkdir(generated, { recursive: true });
  await writeFile(join(generated, 'old.png'), ONE_PIXEL_PNG);
  await writeFile(join(generated, 'new.png'), ONE_PIXEL_PNG);

  try {
    const resolveImages = createImageContextResolver({ publicDir: root, maxImages: 1, maxBytes: 1024 * 1024 });
    const history = [
      { speaker: 'tool', text: 'old', attachments: [{ type: 'image', url: '/generated/old.png' }] },
      { speaker: 'tool', text: 'new', attachments: [{ type: 'image', url: '/generated/new.png' }] },
    ];
    const hydrated = await resolveImages(history);
    assert.equal(hydrated[0].attachments[0].dataUrl, undefined);
    assert.match(hydrated[1].attachments[0].dataUrl, /^data:image\/png;base64,/);
    assert.equal(history[1].attachments[0].dataUrl, undefined, 'resolver must not bloat persisted history');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('generated image remains available until both agents have replied after it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ai-chat-vision-'));
  const generated = join(root, 'generated');
  await mkdir(generated, { recursive: true });
  await writeFile(join(generated, 'scene.png'), ONE_PIXEL_PNG);

  try {
    const resolveImages = createImageContextResolver({ publicDir: root, maxImages: 1, maxBytes: 1024 * 1024 });
    const attachment = { type: 'image', url: '/generated/scene.png' };

    const oneAgentReplied = await resolveImages([
      { speaker: 'tool', text: 'image', attachments: [attachment] },
      { speaker: 'a', text: 'đã xem ảnh' },
    ]);
    assert.match(oneAgentReplied[0].attachments[0].dataUrl, /^data:image\/png;base64,/);

    const bothAgentsReplied = await resolveImages([
      { speaker: 'tool', text: 'image', attachments: [attachment] },
      { speaker: 'a', text: 'đã xem ảnh' },
      { speaker: 'b', text: 'cũng đã xem ảnh' },
    ]);
    assert.equal(bothAgentsReplied[0].attachments[0].dataUrl, undefined, 'old image should stop inflating later requests');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local image resolver rejects path traversal outside generated directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ai-chat-vision-'));
  try {
    await assert.rejects(() => localImageToDataUrl(root, '/generated/../secret.png'), /không hợp lệ/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
