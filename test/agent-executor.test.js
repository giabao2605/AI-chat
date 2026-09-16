import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentExecutor } from '../src/agent-executor.js';

function usage(input = 2, output = 1) {
  return { inputTokens: input, outputTokens: output, totalTokens: input + output, exact: true };
}

test('executor streams one provider turn and returns merged diagnostics', async () => {
  const events = [];
  const executor = new AgentExecutor();
  const result = await executor.execute({
    agentId: 'a',
    agentName: 'Alpha',
    messageId: 'm1',
    provider: {
      async streamChat({ onDelta }) {
        onDelta('hel');
        onDelta('lo');
        return { text: 'hello', usage: usage(), diagnostics: { queueMs: 3 }, toolCalls: [] };
      },
    },
    messages: [{ role: 'user', content: 'hi' }],
    temperature: 0.8,
    maxOutputTokens: 100,
    isActive: () => true,
    emit: (name, payload) => events.push([name, payload]),
  });

  assert.equal(result.text, 'hello');
  assert.deepEqual(result.usage, usage());
  assert.equal(result.providerDiagnostics.length, 1);
  assert.equal(result.providerDiagnostics[0].queueMs, 3);
  assert.deepEqual(events.map(([name]) => name), ['message:start', 'message:delta', 'message:delta']);
});

test('executor emits a synthetic start/delta when provider returns text without streaming deltas', async () => {
  const events = [];
  const executor = new AgentExecutor();
  const result = await executor.execute({
    agentId: 'a', agentName: 'Alpha', messageId: 'm2',
    provider: { async streamChat() { return { text: 'fallback text', usage: usage(), toolCalls: [] }; } },
    messages: [{ role: 'user', content: 'hi' }],
    isActive: () => true,
    emit: (name, payload) => events.push([name, payload]),
  });

  assert.equal(result.text, 'fallback text');
  assert.deepEqual(events.map(([name]) => name), ['message:start', 'message:delta']);
  assert.equal(events[1][1].delta, 'fallback text');
});

test('executor runs the image tool loop and merges usage across provider calls', async () => {
  const calls = [];
  const entries = [];
  const messages = [{ role: 'user', content: 'make image' }];
  const executor = new AgentExecutor();
  const result = await executor.execute({
    agentId: 'a', agentName: 'Alpha', messageId: 'm3',
    provider: {
      async streamChat() {
        calls.push(messages.map((message) => message.content));
        if (calls.length === 1) {
          return {
            text: '',
            usage: usage(4, 1),
            toolCalls: [{ function: { name: 'generate_image', arguments: JSON.stringify({ prompt: 'a tiny moon' }) } }],
          };
        }
        return { text: 'Ảnh xong.', usage: usage(6, 2), toolCalls: [] };
      },
    },
    messages,
    isActive: () => true,
    emit: () => {},
    imageTool: { async generate(prompt) { return { type: 'image', url: '/generated/moon.png', prompt }; } },
    maxImageCalls: 1,
    recordImageToolEntry: async ({ prompt, attachment, errorMessage }) => {
      const entry = { id: 'tool1', prompt, attachment, errorMessage };
      entries.push(entry);
      return entry;
    },
    appendImageToolEntry: async (target, entry) => target.push({ role: 'user', content: `tool:${entry.prompt}` }),
  });

  assert.equal(result.text, 'Ảnh xong.');
  assert.equal(result.imageCallsUsed, 1);
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 3, totalTokens: 13, exact: true });
  assert.equal(entries[0].prompt, 'a tiny moon');
  assert.match(messages.at(-1).content, /tool:a tiny moon/);
  assert.equal(calls.length, 2);
});

test('executor emits cancellation for an aborted streamed request and does not convert it to failure', async () => {
  const events = [];
  const controller = new AbortController();
  const executor = new AgentExecutor();
  const task = executor.execute({
    agentId: 'a', agentName: 'Alpha', messageId: 'm4',
    provider: {
      async streamChat({ onDelta, signal }) {
        onDelta('partial');
        return await new Promise((resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        });
      },
    },
    messages: [{ role: 'user', content: 'hi' }],
    signal: controller.signal,
    isActive: () => !controller.signal.aborted,
    emit: (name, payload) => events.push([name, payload]),
  });

  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(task, /Abort/);
  assert.ok(events.some(([name]) => name === 'message:cancelled'));
  assert.ok(!events.some(([name]) => name === 'message:failed'));
});
