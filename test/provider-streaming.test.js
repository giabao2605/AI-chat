import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider } from '../src/provider.js';

function sse(text = 'ok') {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

test('provider caches unsupported stream_options and skips the failed probe on later turns', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (body.stream_options) return new Response('stream_options unsupported', { status: 400 });
    return sse('ok');
  };

  try {
    const provider = new OpenAICompatibleProvider({ baseUrl: 'https://provider.test/v1', apiKey: 'secret', model: 'm' });
    const messages = [{ role: 'user', content: 'hello' }];

    const first = await provider.streamChat({ messages });
    assert.equal(first.text, 'ok');
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[0].stream_options, { include_usage: true });
    assert.equal(bodies[1].stream_options, undefined);

    const second = await provider.streamChat({ messages });
    assert.equal(second.text, 'ok');
    assert.equal(bodies.length, 3, 'second turn should make only one provider request');
    assert.equal(bodies[2].stream_options, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
