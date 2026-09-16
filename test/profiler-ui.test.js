import test from 'node:test';
import assert from 'node:assert/strict';
import { profilerText } from '../public/profiler-ui.js';

test('profiler formatter renders performance and token anatomy', () => {
  const text = profilerText({
    debug: {
      totalMs: 2500,
      firstTokenMs: 900,
      research: { ms: 300 },
      providerCalls: [{
        ms: 1800,
        finalHeadersMs: 500,
        firstTextMs: 900,
        inputProfile: {
          reportedInputTokens: 4200,
          usageExact: true,
          estimatedInputTokens: 4000,
          estimateDeltaTokens: 200,
          breakdown: {
            systemAndPersona: 1000,
            recentHistory: 2500,
            toolSchemas: 500,
          },
        },
      }],
    },
  });

  assert.match(text, /PERFORMANCE/);
  assert.match(text, /Turn total: 2500 ms/);
  assert.match(text, /TOKEN ANATOMY/);
  assert.match(text, /Input: 4\.200 \(exact provider usage\)/);
  assert.match(text, /System \+ persona: ~1\.000/);
  assert.match(text, /Delta vs provider: \+200/);
});

test('profiler formatter tolerates old messages without profiler fields', () => {
  assert.equal(profilerText({ debug: {} }), '');
  assert.doesNotThrow(() => profilerText({ debug: { totalMs: 12, providerCalls: [] } }));
});
