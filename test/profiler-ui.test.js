import test from 'node:test';
import assert from 'node:assert/strict';
import { profilerText } from '../public/profiler-ui.js';

test('profiler formatter renders performance, context budget and token anatomy', () => {
  const text = profilerText({
    debug: {
      totalMs: 2500,
      firstTokenMs: 900,
      research: { ms: 300 },
      providerCalls: [{
        ms: 1800,
        finalHeadersMs: 500,
        firstTextMs: 900,
        contextBudget: {
          enabled: true,
          budgetTokens: 12000,
          targetTokens: 10560,
          beforeEstimatedTokens: 14000,
          afterEstimatedTokens: 9800,
          dropped: [
            { category: 'recentHistory', estimatedTokens: 2500 },
            { category: 'summary', estimatedTokens: 1700 },
          ],
          overBudget: false,
        },
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
  assert.match(text, /CONTEXT BUDGET/);
  assert.match(text, /Budget: 12\.000 tokens · target 10\.560/);
  assert.match(text, /Estimated input: 14\.000 → 9\.800/);
  assert.match(text, /Dropped 2:/);
  assert.match(text, /Recent history: 1 \(~2\.500\)/);
  assert.match(text, /Conversation summary: 1 \(~1\.700\)/);
  assert.match(text, /TOKEN ANATOMY/);
  assert.match(text, /Input: 4\.200 \(exact provider usage\)/);
  assert.match(text, /System \+ persona: ~1\.000/);
  assert.match(text, /Delta vs provider: \+200/);
});

test('profiler formatter warns when mandatory context alone is over target', () => {
  const text = profilerText({
    debug: {
      providerCalls: [{
        contextBudget: {
          enabled: true,
          budgetTokens: 1000,
          targetTokens: 880,
          beforeEstimatedTokens: 1300,
          afterEstimatedTokens: 1100,
          dropped: [],
          overBudget: true,
          mandatoryExceeded: true,
        },
      }],
    },
  });
  assert.match(text, /protected\/mandatory context alone still exceeds target/);
});

test('profiler formatter tolerates old messages without profiler fields', () => {
  assert.equal(profilerText({ debug: {} }), '');
  assert.doesNotThrow(() => profilerText({ debug: { totalMs: 12, providerCalls: [] } }));
});
