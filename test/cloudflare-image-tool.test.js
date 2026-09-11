import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CloudflareImageTool, extractCloudflareImage } from '../src/cloudflare-image-tool.js';

const ONE_PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64');

test('Cloudflare payload extracts Workers AI base64 image output', () => {
  assert.equal(extractCloudflareImage({ result: { image: 'abc' }, success: true }), 'abc');
  assert.equal(extractCloudflareImage({ result: 'def', success: true }), 'def');
  assert.equal(extractCloudflareImage({ image: 'ghi' }), 'ghi');
});

test('Cloudflare image tool calls Workers AI and saves the generated image', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-chat-cf-image-'));
  const requests = [];
  const tool = new CloudflareImageTool({
    accountId: 'account-123',
    apiToken: 'cf-secret',
    model: '@cf/black-forest-labs/flux-1-schnell',
    outputDir: dir,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({
        result: { image: ONE_PIXEL_PNG.toString('base64') },
        success: true,
        errors: [],
        messages: [],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  try {
    const result = await tool.generate('tạo ảnh bầu trời');
    assert.equal(requests.length, 1);
    assert.equal(
      requests[0].url,
      'https://api.cloudflare.com/client/v4/accounts/account-123/ai/run/@cf/black-forest-labs/flux-1-schnell',
    );
    assert.equal(requests[0].options.headers.authorization, 'Bearer cf-secret');
    assert.deepEqual(JSON.parse(requests[0].options.body), { prompt: 'tạo ảnh bầu trời' });
    assert.equal(result.type, 'image');
    assert.equal(result.provider, 'cloudflare');
    assert.equal(result.model, '@cf/black-forest-labs/flux-1-schnell');
    assert.match(result.url, /^\/generated\/.+\.jpg$/);
    const saved = await readFile(join(dir, result.url.split('/').at(-1)));
    assert.deepEqual(saved, ONE_PIXEL_PNG);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Cloudflare image tool surfaces API error details', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-chat-cf-image-'));
  const tool = new CloudflareImageTool({
    accountId: 'account-123',
    apiToken: 'cf-secret',
    model: '@cf/black-forest-labs/flux-1-schnell',
    outputDir: dir,
    fetchImpl: async () => new Response(JSON.stringify({
      success: false,
      errors: [{ code: 5007, message: 'No such model' }],
    }), { status: 400, headers: { 'content-type': 'application/json' } }),
  });

  try {
    await assert.rejects(() => tool.generate('test'), /5007.*No such model/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
