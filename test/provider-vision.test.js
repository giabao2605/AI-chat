import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider, hasImageInput, normalizeMessagesForProvider, toTextOnlyMessages } from '../src/provider.js';

const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

function visionMessages() {
  return [
    { role: 'system', content: 'Rules' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Nhận xét ảnh này' },
        { type: 'image_url', image_url: { url: DATA_URL, detail: 'auto' } },
      ],
    },
  ];
}

function sse(text = 'ok') {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

test('provider normalization preserves OpenAI-compatible image_url parts', () => {
  const normalized = normalizeMessagesForProvider(visionMessages());
  assert.equal(hasImageInput(normalized), true);
  assert.equal(normalized[1].content[1].type, 'image_url');
  assert.equal(normalized[1].content[1].image_url.url, DATA_URL);
  const textOnly = toTextOnlyMessages(normalized);
  assert.equal(typeof textOnly[1].content, 'string');
  assert.match(textOnly[1].content, /Ảnh đính kèm/);
});

test('provider falls back to text once when image input is rejected and caches capability', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (hasImageInput(body.messages)) return new Response('unsupported vision', { status: 400 });
    return sse('fallback ok');
  };

  try {
    const provider = new OpenAICompatibleProvider({ baseUrl: 'https://provider.test/v1', apiKey: 'secret', model: 'm' });
    const first = await provider.streamChat({ messages: visionMessages() });
    assert.equal(first.visionFallback, true);
    assert.equal(first.text, 'fallback ok');
    assert.equal(bodies.length, 3, 'first turn tries with usage, without usage, then text fallback');
    assert.equal(hasImageInput(bodies[0].messages), true);
    assert.equal(hasImageInput(bodies[1].messages), true);
    assert.equal(hasImageInput(bodies[2].messages), false);

    const second = await provider.streamChat({ messages: visionMessages() });
    assert.equal(second.visionFallback, true);
    assert.equal(bodies.length, 4, 'cached unsupported vision skips repeated failed image attempts');
    assert.equal(hasImageInput(bodies[3].messages), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
