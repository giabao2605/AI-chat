import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_GENERATION_TOOL } from '../src/agent-tools.js';
import { OpenAICompatibleProvider } from '../src/provider.js';

function sseToolCall() {
  const chunks = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'generate_image', arguments: '{"prompt":"hồ ' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'nước"}' } }] } }] },
  ];
  return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function sseText(text = 'ok') {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

test('provider sends tool definitions and reconstructs streamed tool-call arguments', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return sseToolCall();
  };

  try {
    const provider = new OpenAICompatibleProvider({ baseUrl: 'https://provider.test/v1', apiKey: 'secret', model: 'm' });
    const result = await provider.streamChat({
      messages: [{ role: 'user', content: 'Tạo thử ảnh' }],
      tools: [IMAGE_GENERATION_TOOL],
    });
    assert.equal(requestBody.tools[0].function.name, 'generate_image');
    assert.equal(requestBody.tool_choice, 'auto');
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0].id, 'call_1');
    assert.equal(result.toolCalls[0].function.name, 'generate_image');
    assert.equal(result.toolCalls[0].function.arguments, '{"prompt":"hồ nước"}');
    assert.equal(result.toolsAccepted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider falls back without tools when native tool calling is rejected and caches capability', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    if (body.tools) return new Response('unsupported tools', { status: 400 });
    return sseText('fallback text');
  };

  try {
    const provider = new OpenAICompatibleProvider({ baseUrl: 'https://provider.test/v1', apiKey: 'secret', model: 'm' });
    const first = await provider.streamChat({
      messages: [{ role: 'user', content: 'hello' }],
      tools: [IMAGE_GENERATION_TOOL],
    });
    assert.equal(first.toolFallback, true);
    assert.equal(first.text, 'fallback text');
    assert.equal(bodies.length, 3, 'tries with usage, without usage, then without tools');
    assert.ok(bodies[0].tools);
    assert.ok(bodies[1].tools);
    assert.equal(bodies[2].tools, undefined);

    const second = await provider.streamChat({
      messages: [{ role: 'user', content: 'hello again' }],
      tools: [IMAGE_GENERATION_TOOL],
    });
    assert.equal(second.toolFallback, true);
    assert.equal(bodies.length, 4, 'cached unsupported tools avoids repeating failed requests');
    assert.equal(bodies[3].tools, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
