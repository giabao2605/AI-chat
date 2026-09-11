import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_GENERATION_TOOL, IMAGE_TOOL_NAME, parseImageToolCall } from '../src/agent-tools.js';

test('agent image tool exposes a strict prompt schema', () => {
  assert.equal(IMAGE_TOOL_NAME, 'generate_image');
  assert.equal(IMAGE_GENERATION_TOOL.type, 'function');
  assert.equal(IMAGE_GENERATION_TOOL.function.name, IMAGE_TOOL_NAME);
  assert.deepEqual(IMAGE_GENERATION_TOOL.function.parameters.required, ['prompt']);
  assert.equal(IMAGE_GENERATION_TOOL.function.parameters.additionalProperties, false);
});

test('agent image tool parses a valid provider tool call', () => {
  assert.deepEqual(parseImageToolCall({
    function: {
      name: 'generate_image',
      arguments: JSON.stringify({ prompt: 'một hồ nước xanh giữa núi đá' }),
    },
  }), {
    prompt: 'một hồ nước xanh giữa núi đá',
    error: '',
  });
});

test('agent image tool rejects malformed or empty arguments without throwing', () => {
  assert.match(parseImageToolCall({ function: { name: 'generate_image', arguments: '{' } }).error, /JSON/i);
  assert.match(parseImageToolCall({ function: { name: 'generate_image', arguments: '{}' } }).error, /thiếu prompt/i);
  assert.equal(parseImageToolCall({ function: { name: 'other_tool', arguments: '{}' } }), null);
});
