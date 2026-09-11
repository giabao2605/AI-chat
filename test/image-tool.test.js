import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenAICompatibleImageTool, extractImagePayload, imageEndpoint } from '../src/image-tool.js';

const ONE_PIXEL_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64');

test('image endpoint normalizes an OpenAI-compatible base URL', () => {
  assert.equal(imageEndpoint('https://provider.test/v1/'), 'https://provider.test/v1/images/generations');
  assert.equal(imageEndpoint('https://provider.test/v1/images/generations'), 'https://provider.test/v1/images/generations');
  assert.equal(imageEndpoint('', 'https://proxy.test/images'), 'https://proxy.test/images');
});

test('image payload accepts common base64 and URL response shapes', () => {
  assert.equal(extractImagePayload({ data: [{ b64_json: 'abc' }] }).base64, 'abc');
  assert.equal(extractImagePayload({ images: [{ url: 'https://example.test/a.png' }] }).url, 'https://example.test/a.png');
});

test('image tool saves base64 output into the generated directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-chat-image-'));
  const requests = [];
  const tool = new OpenAICompatibleImageTool({
    baseUrl: 'https://provider.test/v1',
    apiKey: 'secret',
    model: 'image-model',
    size: '1024x1024',
    outputDir: dir,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ data: [{ b64_json: ONE_PIXEL_PNG.toString('base64'), revised_prompt: 'night sky' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  try {
    const result = await tool.generate('tạo ảnh bầu trời');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'https://provider.test/v1/images/generations');
    assert.equal(requests[0].options.headers.authorization, 'Bearer secret');
    const body = JSON.parse(requests[0].options.body);
    assert.equal(body.model, 'image-model');
    assert.equal(body.prompt, 'tạo ảnh bầu trời');
    assert.equal(body.size, '1024x1024');
    assert.match(result.url, /^\/generated\/.+\.png$/);
    assert.equal(result.type, 'image');
    assert.equal(result.revisedPrompt, 'night sky');
    const saved = await readFile(join(dir, result.url.split('/').at(-1)));
    assert.deepEqual(saved, ONE_PIXEL_PNG);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('image tool fails closed when provider returns no image', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-chat-image-'));
  const tool = new OpenAICompatibleImageTool({
    baseUrl: 'https://provider.test/v1',
    apiKey: 'secret',
    model: 'image-model',
    outputDir: dir,
    fetchImpl: async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
  });
  try {
    await assert.rejects(() => tool.generate('test'), /không trả dữ liệu ảnh/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
