import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  OpenAICompatibleProvider,
  estimateTokensFromText,
  normalizeMessagesForProvider,
  normalizeUsage,
  resetProviderCapabilityCacheForTests,
} from '../src/provider.js';

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('estimateTokensFromText returns a conservative non-zero estimate', () => {
  assert.equal(estimateTokensFromText(''), 0);
  assert.equal(estimateTokensFromText('abcd'), 1);
  assert.equal(estimateTokensFromText('abcde'), 2);
});

test('normalizeUsage accepts OpenAI and input/output token shapes', () => {
  assert.deepEqual(normalizeUsage({ prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 }), {
    inputTokens: 10,
    outputTokens: 4,
    totalTokens: 14,
    exact: true,
  });
  assert.deepEqual(normalizeUsage({ input_tokens: 7, output_tokens: 2 }), {
    inputTokens: 7,
    outputTokens: 2,
    totalTokens: 9,
    exact: true,
  });
});

test('provider merges all system messages into the first message so gateways cannot drop research context', () => {
  const messages = normalizeMessagesForProvider([
    { role: 'system', content: 'Luật chung' },
    { role: 'system', content: 'DỮ LIỆU WEB VỪA TRA CỨU\n[1] Fact' },
    { role: 'user', content: 'Thời tiết hôm nay?' },
  ]);

  assert.equal(messages.filter((message) => message.role === 'system').length, 1);
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /Luật chung/);
  assert.match(messages[0].content, /DỮ LIỆU WEB VỪA TRA CỨU/);
  assert.equal(messages[1].role, 'user');
});

test('provider streams deltas and captures exact usage when the gateway emits it', async (t) => {
  resetProviderCapabilityCacheForTests();
  const server = await listen(async (req, res) => {
    for await (const _ of req) {}
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"Xin "}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"chào"}}]}\n\n');
    res.write('data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3,"total_tokens":15}}\n\n');
    res.end('data: [DONE]\n\n');
  });
  t.after(() => server.close());
  const address = server.address();
  const provider = new OpenAICompatibleProvider({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: 'test',
    model: 'mock',
  });
  let streamed = '';
  const result = await provider.streamChat({
    messages: [{ role: 'user', content: 'hi' }],
    onDelta: (delta) => { streamed += delta; },
  });
  assert.equal(streamed, 'Xin chào');
  assert.equal(result.text, 'Xin chào');
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 3, totalTokens: 15, exact: true });
  assert.equal(result.diagnostics.requestCount, 1);
});

test('generic gateways do not pay a failed stream_options probe before the real request', async (t) => {
  resetProviderCapabilityCacheForTests();
  let requests = 0;
  const server = await listen(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests += 1;
    assert.equal(JSON.parse(body).stream_options, undefined);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    return res.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
  });
  t.after(() => server.close());
  const address = server.address();
  const provider = new OpenAICompatibleProvider({
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey: 'test',
    model: 'mock',
  });
  const result = await provider.streamChat({ messages: [{ role: 'user', content: 'hello' }] });
  assert.equal(requests, 1);
  assert.equal(result.text, 'ok');
  assert.equal(result.usage.exact, false);
  assert.ok(result.usage.totalTokens > 0);
});
