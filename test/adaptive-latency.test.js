import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OpenAICompatibleProvider,
  resetProviderCapabilityCacheForTests,
  selectAdaptiveReasoningEffort,
} from '../src/provider.js';
import { ProfiledRoom } from '../src/profiled-room.js';

function sseResponse(events = []) {
  const text = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`;
  return new Response(text, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function deltaText(text) {
  return { choices: [{ delta: { content: text } }] };
}

test('GPT-5.6 fast path stays one provider request and uses low reasoning for a light turn', async () => {
  resetProviderCapabilityCacheForTests();
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
    assert.equal(bodies[0].prompt_cache_key, undefined, 'generic gateways should not receive speculative cache parameters');
    assert.ok(!Array.isArray(bodies[0].tools) || !bodies[0].tools.some((tool) => tool.function?.name === 'request_deeper_reasoning'));
    assert.equal(result.diagnostics.requestCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('adaptive reasoning raises budget before the request instead of self-escalating through another model call', async () => {
  resetProviderCapabilityCacheForTests();
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return sseResponse([deltaText('Kết quả.')]);
  };

  try {
    const structured = `${'Phân tích các ràng buộc sau.\n'.repeat(35)}${'{a: 1, b: 2} -> (a + b)'.repeat(30)}`;
    assert.ok(['medium', 'high'].includes(selectAdaptiveReasoningEffort([
      { role: 'user', content: structured },
    ], { requested: 'low' })));

    const provider = new OpenAICompatibleProvider({
      baseUrl: 'https://example.test/v1',
      apiKey: 'test',
      model: 'gpt-5.6-luna',
    });
    const result = await provider.streamChat({
      messages: [{ role: 'user', content: structured }],
      adaptiveReasoning: true,
      reasoningEffort: 'low',
    });

    assert.equal(bodies.length, 1, 'adaptive budget selection must not add a hidden classifier/escalation request');
    assert.ok(['medium', 'high'].includes(bodies[0].reasoning_effort));
    assert.equal(result.diagnostics.requestCount, 1);
    assert.equal(result.diagnostics.adaptiveEscalated, true);
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
