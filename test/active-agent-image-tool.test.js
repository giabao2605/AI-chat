import test from 'node:test';
import assert from 'node:assert/strict';
import { ScenarioRoom } from '../src/scenario-room.js';

const agents = {
  a: { id: 'a', name: 'Alpha', apiKey: 'x', model: 'm1', baseUrl: 'http://mock' },
  b: { id: 'b', name: 'Beta', apiKey: 'y', model: 'm2', baseUrl: 'http://mock' },
};

const usage = { inputTokens: 4, outputTokens: 2, totalTokens: 6, exact: true };

test('active agent may call generate_image, receives the generated image in context, then finishes the same turn', async () => {
  const imagePrompts = [];
  let aCalls = 0;
  let sawImageOnFollowup = false;
  const providerFactory = (config) => ({
    async streamChat({ messages, tools, onDelta }) {
      if (config.id !== 'a') throw new Error('Beta should not run in a one-turn test');
      aCalls += 1;
      const toolNames = (tools || []).map((tool) => tool?.function?.name).filter(Boolean);
      if (aCalls === 1) {
        assert.ok(toolNames.includes('generate_image'));
        return {
          text: '',
          toolCalls: [{
            id: 'call_img',
            type: 'function',
            function: { name: 'generate_image', arguments: JSON.stringify({ prompt: 'hồ nước xanh giữa núi đá' }) },
          }],
          usage,
          toolsAccepted: true,
        };
      }

      assert.equal(toolNames.includes('generate_image'), false, 'default limit allows only one image call per turn');
      sawImageOnFollowup = messages.some((message) => Array.isArray(message.content)
        && message.content.some((part) => part?.type === 'image_url'));
      const text = 'Ảnh vừa tạo có hồ nước xanh và núi đá, khá hợp chủ đề.';
      onDelta?.(text);
      return { text, toolCalls: [], usage, toolsAccepted: false };
    },
  });

  const imageTool = {
    async generate(prompt) {
      imagePrompts.push(prompt);
      return {
        type: 'image',
        url: '/generated/mock.png',
        alt: prompt,
        prompt,
        model: 'mock-image',
      };
    },
  };

  const imageContextResolver = async (history) => history.map((item) => ({
    ...item,
    attachments: Array.isArray(item.attachments)
      ? item.attachments.map((attachment) => ({ ...attachment, dataUrl: 'data:image/png;base64,aGVsbG8=' }))
      : item.attachments,
  }));

  const room = new ScenarioRoom({
    agents,
    hardTurnLimit: 10,
    providerFactory,
    imageTool,
    imageContextResolver,
    maxImageToolCallsPerTurn: 1,
    contextConfig: { summarizeAfter: 100 },
  });

  const completed = new Promise((resolve) => {
    const listener = (snapshot) => {
      if (snapshot.status === 'completed') {
        room.off('state', listener);
        resolve(snapshot);
      }
    };
    room.on('state', listener);
  });

  await room.start({
    topicMode: 'manual',
    conversationMode: 'turns',
    topic: 'Phong cảnh',
    maxTurns: 1,
    startSpeaker: 'a',
    sharedPrompt: 'Rules',
  });
  const snapshot = await completed;

  assert.deepEqual(imagePrompts, ['hồ nước xanh giữa núi đá']);
  assert.equal(sawImageOnFollowup, true);
  assert.deepEqual(snapshot.history.map((item) => item.speaker), ['tool', 'a']);
  assert.equal(snapshot.history[0].attachments[0].url, '/generated/mock.png');
  assert.match(snapshot.history[0].text, /Alpha.*tool tạo ảnh/i);
  assert.match(snapshot.history[1].text, /hồ nước xanh/i);
  assert.equal(snapshot.stats.a.turns, 1);
  assert.equal(snapshot.stats.a.totalTokens, 12, 'tool-selection and final-response usage are combined into one turn');
});
