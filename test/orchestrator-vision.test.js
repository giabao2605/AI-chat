import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessagesForAgent } from '../src/orchestrator.js';

test('generated image attachment becomes multimodal user content for both agents', () => {
  const messages = buildMessagesForAgent({
    agentId: 'a',
    agentName: 'Alpha',
    topic: 'Ảnh hồ nước',
    sharedPrompt: 'Rules',
    personaPrompt: '',
    history: [{
      speaker: 'tool',
      name: 'Image Generator',
      text: 'Đã tạo ảnh hồ nước',
      attachments: [{ type: 'image', url: '/generated/lake.png', dataUrl: 'data:image/png;base64,AAAA' }],
    }],
  });

  const imageMessage = messages.at(-1);
  assert.equal(imageMessage.role, 'user');
  assert.ok(Array.isArray(imageMessage.content));
  assert.match(imageMessage.content[0].text, /quan sát trực tiếp/i);
  assert.equal(imageMessage.content[1].type, 'image_url');
  assert.equal(imageMessage.content[1].image_url.url, 'data:image/png;base64,AAAA');
});
