import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_GENERATION_TOOL, PRIVATE_CONTEXT_TOOL, PRIVATE_CONTEXT_TOOL_NAME } from '../src/agent-tools.js';
import { OpenAICompatibleProvider, resetProviderCapabilityCacheForTests } from '../src/provider.js';

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

function sseMultiplePrivateToolCalls() {
  const chunks = [
    {
      choices: [{
        delta: {
          tool_calls: [
            {
              index: 0,
              id: 'private_b',
              type: 'function',
              function: { name: PRIVATE_CONTEXT_TOOL_NAME, arguments: '{"recipient":"b","content":"ONE' },
            },
            {
              index: 1,
              id: 'private_c',
              type: 'function',
              function: { name: PRIVATE_CONTEXT_TOOL_NAME, arguments: '{"recipient":"c","content":"TWO' },
            },
          ],
        },
      }],
    },
    {
      choices: [{
        delta: {
          tool_calls: [
            { index: 0, function: { arguments: '"}' } },
            { index: 1, function: { arguments: '"}' } },
          ],
        },
      }],
    },
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
  resetProviderCapabilityCacheForTests();
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

test('provider reconstructs multiple parallel private-context tool calls by stream index', async () => {
  resetProviderCapabilityCacheForTests();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => sseMultiplePrivateToolCalls();

  try {
    const provider = new OpenAICompatibleProvider({ baseUrl: 'https://provider.test/v1', apiKey: 'secret', model: 'm' });
    const result = await provider.streamChat({
      messages: [{ role: 'user', content: 'Gửi riêng cho B và C' }],
      tools: [PRIVATE_CONTEXT_TOOL],
    });

    assert.equal(result.toolCalls.length, 2);
    assert.deepEqual(result.toolCalls.map((call) => ({
      id: call.id,
      name: call.function.name,
      args: JSON.parse(call.function.arguments),
    })), [
      { id: 'private_b', name: PRIVATE_CONTEXT_TOOL_NAME, args: { recipient: 'b', content: 'ONE' } },
      { id: 'private_c', name: PRIVATE_CONTEXT_TOOL_NAME, args: { recipient: 'c', content: 'TWO' } },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('provider falls back only once when native tool calling is explicitly rejected and caches capability', async () => {
  resetProviderCapabilityCacheForTests();
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
    assert.equal(bodies.length, 2, 'targeted fallback must not probe unrelated capabilities');
    assert.ok(bodies[0].tools);
    assert.equal(bodies[1].tools, undefined);
    assert.equal(first.diagnostics.attempts[0].retryReason, 'tools');

    const second = await provider.streamChat({
      messages: [{ role: 'user', content: 'hello again' }],
      tools: [IMAGE_GENERATION_TOOL],
    });
    assert.equal(second.toolFallback, true);
    assert.equal(bodies.length, 3, 'cached unsupported tools avoids repeating failed requests');
    assert.equal(bodies[2].tools, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
