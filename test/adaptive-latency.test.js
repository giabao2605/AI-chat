import test from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatibleProvider } from '../src/provider.js';
import { ProfiledRoom } from '../src/profiled-room.js';

function sseResponse(events = []) {
  const text = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function deltaText(text) {
  return { choices: [{ delta: { content: text } }] };
}

function toolCall(name, args) {
  return {
    choices: [{
      delta: {
        tool_calls: [{
          index: 0,
          id: 'call_reason',
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        }],
      },
    }],
  };
}

test('GPT-5.6 fast path uses low reasoning and stays one provider request for a simple turn', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return sseResponse([deltaText('Chào buổi sáng!')]);
  };

  try {
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'test',
      model: 'gpt-5.6-luna',
    });
    let streamed = '';
    const result = await provider.streamChat({
      messages: [{ role: 'user', content: 'hello' }],
      adaptiveReasoning: true,
      reasoningEffort: 'low',
      promptCacheKey: 'ai-chat:a:gpt-5.6-luna',
      onDelta: (delta) => { streamed += delta; },
    });

    assert.equal(result.text, 'Chào buổi sáng!');
    assert.equal(streamed, 'Chào buổi sáng!');
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].reasoning_effort, 'low');
    assert.equal(bodies[0].prompt_cache_key, 'ai-chat:a:gpt-5.6-luna');
    assert.ok(bodies[0].tools.some((tool) => tool.function?.name === 'request_deeper_reasoning'));
    assert.equal(result.diagnostics.adaptiveEscalated, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('GPT-5.6 can self-escalate to deeper reasoning without leaking the internal tool upward', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  let call = 0;
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    call += 1;
    if (call === 1) {
      return sseResponse([toolCall('request_deeper_reasoning', {
        effort: 'high',
        reason: 'Cần kiểm tra nhiều ràng buộc phụ thuộc nhau.',
      })]);
    }
    return sseResponse([deltaText('Kết quả sau khi suy luận sâu.')]);
  };

  try {
    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'test',
      model: 'gpt-5.6-luna',
    });
    let streamed = '';
    const result = await provider.streamChat({
      messages: [{ role: 'user', content: 'Giải bài toán này thật chắc chắn.' }],
      adaptiveReasoning: true,
      reasoningEffort: 'low',
      onDelta: (delta) => { streamed += delta; },
    });

    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].reasoning_effort, 'low');
    assert.equal(bodies[1].reasoning_effort, 'high');
    assert.ok(bodies[0].tools.some((tool) => tool.function?.name === 'request_deeper_reasoning'));
    assert.ok(!Array.isArray(bodies[1].tools) || !bodies[1].tools.some((tool) => tool.function?.name === 'request_deeper_reasoning'));
    assert.equal(result.toolCalls.length, 0);
    assert.equal(result.text, 'Kết quả sau khi suy luận sâu.');
    assert.equal(streamed, 'Kết quả sau khi suy luận sâu.');
    assert.equal(result.diagnostics.adaptiveEscalated, true);
    assert.equal(result.diagnostics.adaptiveToEffort, 'high');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('context compaction returns immediately with a bounded provisional digest and refreshes in background', async () => {
  const providerCalls = [];
  const providerFactory = () => ({
    async streamChat(options = {}) {
      providerCalls.push(options);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        text: 'Bản tóm tắt đã nén.',
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, exact: true },
        diagnostics: {},
      };
    },
  });
  const room = new ProfiledRoom({
    agents: {
      a: { name: 'A', apiKey: 'a', model: 'gpt-5.6-luna', baseUrl: 'https://example.test/v1' },
      b: { name: 'B', apiKey: 'b', model: 'gpt-5.6-luna', baseUrl: 'https://example.test/v1' },
    },
    providerFactory,
    contextConfig: { recentMessages: 2, summarizeAfter: 3, maxSummaryChars: 240 },
  });
  room.createProviders();
  room.history = [
    { speaker: 'user', name: 'Bạn', text: 'Dữ kiện một rất quan trọng.' },
    { speaker: 'a', name: 'A', text: 'Đã ghi nhận dữ kiện một.' },
    { speaker: 'user', name: 'Bạn', text: 'Dữ kiện hai.' },
    { speaker: 'b', name: 'B', text: 'Đã ghi nhận dữ kiện hai.' },
  ];

  const started = Date.now();
  const debug = await room.maybeRefreshSummary('a', room.history.slice(), new AbortController().signal);
  const elapsed = Date.now() - started;

  assert.equal(debug.background, true);
  assert.equal(debug.queued, true);
  assert.ok(elapsed < 100, `compaction should not block the turn, got ${elapsed}ms`);
  assert.equal(room.summaryCoveredIndex, 2);
  assert.match(room.contextSummary, /Dữ kiện một|ghi nhận dữ kiện một/);

  await room.summaryRefreshPromise;
  assert.equal(room.contextSummary, 'Bản tóm tắt đã nén.');
  const summaryCall = providerCalls.find((options) => options.reasoningEffort === 'low');
  assert.ok(summaryCall, 'background summary should use low reasoning effort');
  assert.equal(summaryCall.adaptiveReasoning, false);
});
