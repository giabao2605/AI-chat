import test from 'node:test';
import assert from 'node:assert/strict';
import { ContextAssembler } from '../src/context-assembler.js';

test('generated image attachment becomes multimodal user content for another agent', () => {
  const assembler = new ContextAssembler();
  const messages = assembler.buildAgentMessages({
    agentId: 'a',
    agentName: 'Alpha',
    participants: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
    topic: 'Ảnh hồ nước',
    sharedPrompt: 'Rules',
    recentHistory: [{
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
