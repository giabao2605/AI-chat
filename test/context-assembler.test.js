import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextAssembler } from '../src/context-assembler.js';

const baseMessages = [
  { role: 'system', content: 'system' },
  { role: 'user', content: 'topic' },
  { role: 'assistant', content: 'old reply' },
  { role: 'user', content: 'latest trigger' },
];

test('active turn base assembly preserves identity, summary, steering and speaker role mapping', () => {
  const assembler = new ContextAssembler();
  const messages = assembler.buildAgentMessages({
    agentId: 'a',
    agentName: 'Alpha',
    participants: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
    topic: 'test topic',
    recentHistory: [
      { speaker: 'a', name: 'Alpha', text: 'my old reply' },
      { speaker: 'b', name: 'Beta', text: 'their reply' },
    ],
    sharedPrompt: 'shared rules',
    personaPrompt: 'persona rules',
    summary: 'old summary',
    loopGuard: true,
    imageToolAvailable: true,
    conversationMode: 'parallel',
  });

  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /shared rules/);
  assert.match(messages[0].content, /Alpha \(A\), Beta \(B\)/);
  assert.match(messages[0].content, /generate_image/);
  assert.match(messages[0].content, /song song/);
  assert.match(messages[0].content, /persona rules/);
  assert.match(messages[2].content, /conversation_summary/);
  assert.match(messages[3].content, /conversation_steering/);
  assert.equal(messages.at(-2).role, 'assistant');
  assert.equal(messages.at(-2).content, 'my old reply');
  assert.equal(messages.at(-1).role, 'user');
  assert.equal(messages.at(-1).content, 'Beta: their reply');
});

test('memory context is inserted after system messages without mutating the input', () => {
  const assembler = new ContextAssembler();
  const next = assembler.addMemoryContext(baseMessages, '<agent_memory>memory</agent_memory>');
  assert.equal(next[1].content, '<agent_memory>memory</agent_memory>');
  assert.equal(next[1].role, 'user');
  assert.deepEqual(baseMessages.map((message) => message.content), ['system', 'topic', 'old reply', 'latest trigger']);
});

test('private context stays late while the latest task trigger remains last', () => {
  const assembler = new ContextAssembler();
  const next = assembler.addPrivateContext(baseMessages, '<private_agent_context>secret</private_agent_context>');
  assert.equal(next.at(-2).content, '<private_agent_context>secret</private_agent_context>');
  assert.equal(next.at(-1).content, 'latest trigger');
});

test('scenario public/private blocks remain system context directly after the primary system message', () => {
  const assembler = new ContextAssembler();
  const next = assembler.addScenarioContext(baseMessages, {
    publicBlock: '<scenario_public_state>day</scenario_public_state>',
    privateBlock: '<scenario_private_state>role</scenario_private_state>',
  });
  assert.deepEqual(next.slice(0, 4).map((message) => message.role), ['system', 'system', 'system', 'user']);
  assert.match(next[1].content, /scenario_public_state/);
  assert.match(next[2].content, /scenario_private_state/);
});

test('budget decisions use per-agent override and preserve mandatory context semantics', () => {
  const assembler = new ContextAssembler({
    budgetConfig: {
      budgetTokens: 2000,
      safetyMargin: 0,
      imageTokenReserve: 0,
      minRecentMessages: 1,
      agentBudgets: { a: 120 },
    },
  });
  const messages = [
    { role: 'system', content: 'S'.repeat(80) },
    { role: 'user', content: 'topic' },
    { role: 'user', content: '<conversation_summary>' + 'x'.repeat(900) + '</conversation_summary>' },
    { role: 'user', content: 'latest' },
  ];
  const result = assembler.applyBudget(messages, [], { agentId: 'a' });
  assert.equal(result.debug.enabled, true);
  assert.equal(result.debug.budgetTokens, 120);
  assert.ok(result.messages.some((message) => message.content === 'latest'));
  assert.ok(result.messages.some((message) => message.role === 'system'));
});
