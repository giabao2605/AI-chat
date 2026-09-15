import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider, resetProviderCapabilityCacheForTests } from '../src/provider.js';

function sse(text = 'ok') {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

test('generic OpenAI-compatible gateways skip speculative stream_options probes', async () => {
  resetProviderCapabilityCacheForTests();
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    return sse('ok');
  };

  try {
    const provider = new OpenAICompatibleProvider({ baseUrl: 'https://provider.test/v1', apiKey: 'secret', model: 'm' });
    const messages = [{ role: 'user', content: 'hello' }];

    const first = await provider.streamChat({ messages });
    assert.equal(first.text, 'ok');
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].stream_options, undefined);
    assert.equal(first.diagnostics.requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('official endpoint retries only the explicitly rejected stream_options capability and caches it', async () => {
  resetProviderCapabilityCacheForTests();
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (body.stream_options) return new Response('stream_options unsupported', { status: 400 });
    return sse('ok');
  };

  try {
    const provider = new OpenAICompatibleProvider({ baseUrl: 'https://api.openai.com/v1', apiKey: 'secret', model: 'gpt-5.6-luna' });
    const messages = [{ role: 'user', content: 'hello' }];

    const first = await provider.streamChat({ messages, reasoningEffort: 'low' });
    assert.equal(first.text, 'ok');
    assert.equal(bodies.length, 2);
    assert.deepEqual(bodies[0].stream_options, { include_usage: true });
    assert.equal(bodies[1].stream_options, undefined);
    assert.equal(first.diagnostics.attempts[0].retryReason, 'streamUsage');

    const second = await provider.streamChat({ messages, reasoningEffort: 'low' });
    assert.equal(second.text, 'ok');
    assert.equal(bodies.length, 3, 'learned capability should prevent repeated failed probes');
    assert.equal(bodies[2].stream_options, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
