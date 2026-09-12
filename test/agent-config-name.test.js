import test from 'node:test';
import assert from 'node:assert/strict';
import { getAgentConfig } from '../src/config.js';

function withEnv(values, fn) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('agent display name falls back to configured model when NAME is omitted', () => {
  withEnv({
    AGENT_B_NAME: undefined,
    AGENT_B_MODEL: 'gpt-5.6-luna',
    AGENT_B_API_KEY: 'test-key',
    AGENT_B_BASE_URL: 'https://example.test/v1',
  }, () => {
    const config = getAgentConfig('b');
    assert.equal(config.name, 'gpt-5.6-luna');
    assert.equal(config.model, 'gpt-5.6-luna');
  });
});

test('explicit AGENT name remains a display-only override', () => {
  withEnv({
    AGENT_B_NAME: 'ChatGPT 5.6 Luna',
    AGENT_B_MODEL: 'provider-specific-luna-id',
    AGENT_B_API_KEY: 'test-key',
    AGENT_B_BASE_URL: 'https://example.test/v1',
  }, () => {
    const config = getAgentConfig('b');
    assert.equal(config.name, 'ChatGPT 5.6 Luna');
    assert.equal(config.model, 'provider-specific-luna-id');
  });
});
