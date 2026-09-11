import test from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_COMMAND, parseImageCommand, shouldSuggestImageCommand } from '../public/image-command.js';

test('img_gen slash command extracts a natural-language image request', () => {
  assert.equal(IMAGE_COMMAND, '/img_gen');
  assert.deepEqual(parseImageCommand('/img_gen tạo ảnh bầu trời'), {
    matched: true,
    prompt: 'tạo ảnh bầu trời',
  });
  assert.deepEqual(parseImageCommand('/IMG_GEN   thành phố cyberpunk'), {
    matched: true,
    prompt: 'thành phố cyberpunk',
  });
});

test('normal chat text is not intercepted by the image tool', () => {
  assert.equal(parseImageCommand('xin chào').matched, false);
  assert.equal(parseImageCommand('/image test').matched, false);
  assert.equal(parseImageCommand('/img_generation test').matched, false);
});

test('slash suggestion appears while typing the command and hides after the prompt starts', () => {
  assert.equal(shouldSuggestImageCommand('/'), true);
  assert.equal(shouldSuggestImageCommand('/i'), true);
  assert.equal(shouldSuggestImageCommand('/img_gen'), true);
  assert.equal(shouldSuggestImageCommand('/img_gen '), true);
  assert.equal(shouldSuggestImageCommand('/img_gen sky'), false);
  assert.equal(shouldSuggestImageCommand('hello /'), false);
});
