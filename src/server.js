import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAgentConfig, getImageGenConfig, getPublicConfig, getServerConfig, getWebSearchConfig } from './config.js';
import { CloudflareImageTool } from './cloudflare-image-tool.js';
import { OpenAICompatibleImageTool } from './image-tool.js';
import { ResumableConversationRoom } from './resumable-room.js';
import { TavilyWebSearch } from './web-search.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const publicDir = normalize(join(__dirname, '..', 'public'));
const serverConfig = getServerConfig();
const webSearchConfig = getWebSearchConfig();
const webSearch = webSearchConfig.enabled ? new TavilyWebSearch(webSearchConfig) : null;
const imageGenConfig = getImageGenConfig();

function createImageTool(config) {
  if (!config.enabled) return null;
  const shared = {
    model: config.model,
    timeoutMs: config.timeoutMs,
    maxBytes: config.maxBytes,
    outputDir: join(publicDir, 'generated'),
    publicPrefix: '/generated',
  };
  if (config.provider === 'cloudflare') {
    return new CloudflareImageTool({
      ...shared,
      accountId: config.cloudflareAccountId,
      apiToken: config.cloudflareApiToken,
    });
  }
  return new OpenAICompatibleImageTool({
    ...shared,
    baseUrl: config.baseUrl,
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    size: config.size,
  });
}

const imageTool = createImageTool(imageGenConfig);
const room = new ResumableConversationRoom({
  agentA: getAgentConfig('a'),
  agentB: getAgentConfig('b'),
  hardTurnLimit: serverConfig.hardTurnLimit,
  webSearch,
});

const clients = new Set();
const eventNames = [
  'state', 'topic', 'meta', 'message:start', 'message:delta', 'message:done', 'message:cancelled', 'message:failed',
  'stats', 'research:start', 'research:done', 'research:error', 'room:error',
];
for (const eventName of eventNames) {
  room.on(eventName, (payload) => broadcast(eventName, payload));
}
room.on('error', (payload) => broadcast('room:error', payload));

function sendSse(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function broadcast(event, payload) {
  for (const client of clients) sendSse(client, event, payload);
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 512_000) throw new Error('Request body quá lớn.');
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('JSON không hợp lệ.');
  }
}

function cleanImagePrompt(value) {
  return String(value || '').trim().slice(0, 12000);
}

function roomIsActive() {
  return ['starting', 'running', 'paused', 'pausing'].includes(room.status) && Boolean(room.topic);
}

function recordImageMessage(prompt, attachment) {
  if (!roomIsActive()) {
    room.reset();
    room.topic = `Tạo ảnh: ${prompt.slice(0, 240)}`;
    room.status = 'completed';
    room.endedBy = 'tool';
    room.endReason = 'Phiên tạo ảnh trực tiếp bằng /img_gen.';
  }

  const entry = {
    id: randomUUID(),
    speaker: 'tool',
    name: 'Image Generator',
    text: `Đã tạo ảnh theo yêu cầu: ${prompt}`,
    createdAt: new Date().toISOString(),
    usage: null,
    sources: [],
    attachments: [attachment],
  };
  room.history.push(entry);
  room.emit('message:done', entry);
  room.emitState();
  return entry;
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/health') return json(res, 200, {
    ok: true,
    status: room.status,
    webSearch: Boolean(webSearch),
    imageGen: Boolean(imageTool),
    imageProvider: imageTool ? imageGenConfig.provider : null,
  });
  if (req.method === 'GET' && pathname === '/api/config') return json(res, 200, getPublicConfig());
  if (req.method === 'GET' && pathname === '/api/state') return json(res, 200, room.snapshot());

  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    clients.add(res);
    sendSse(res, 'state', room.snapshot());
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const body = await readJson(req);

  if (pathname === '/api/start') {
    const state = await room.start(body);
    return json(res, 200, state);
  }
  if (pathname === '/api/continue') {
    const state = await room.continueFromHistory(body);
    return json(res, 200, state);
  }
  if (pathname === '/api/pause') {
    room.pause();
    return json(res, 200, room.snapshot());
  }
  if (pathname === '/api/resume') {
    room.resume();
    return json(res, 200, room.snapshot());
  }
  if (pathname === '/api/stop') {
    room.stop();
    return json(res, 200, room.snapshot());
  }
  if (pathname === '/api/reset') {
    room.reset();
    return json(res, 200, room.snapshot());
  }
  if (pathname === '/api/message') {
    const entry = room.addUserMessage(body.text);
    return json(res, 200, entry);
  }
  if (pathname === '/api/tools/image') {
    if (!imageTool) return json(res, 503, { error: 'Tool tạo ảnh chưa được cấu hình hoặc đang bị tắt.' });
    const prompt = cleanImagePrompt(body.prompt);
    if (!prompt) return json(res, 400, { error: 'Hãy nhập mô tả ảnh sau /img_gen.' });
    const attachment = await imageTool.generate(prompt);
    const entry = recordImageMessage(prompt, attachment);
    return json(res, 200, { ok: true, entry });
  }

  return json(res, 404, { error: 'API route not found.' });
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

async function serveStatic(res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = normalize(join(publicDir, relative));
  if (!target.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden.' });
  try {
    const data = await readFile(target);
    res.writeHead(200, {
      'content-type': mimeTypes[extname(target)] || 'application/octet-stream',
      'cache-control': pathname.startsWith('/generated/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(data);
  } catch {
    try {
      const data = await readFile(join(publicDir, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      res.end(data);
    } catch {
      json(res, 404, { error: 'Not found.' });
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url.pathname);
    } else {
      await serveStatic(res, url.pathname);
    }
  } catch (error) {
    json(res, 400, { error: error?.message || String(error) });
  }
});

const heartbeat = setInterval(() => {
  for (const client of clients) client.write(': ping\n\n');
}, 20_000);
heartbeat.unref();

server.listen(serverConfig.port, serverConfig.host, () => {
  console.log(`AI Chat Lab running at http://${serverConfig.host}:${serverConfig.port}`);
  console.log('API keys stay server-side. Configure them in .env; never commit that file.');
  console.log(`Web search: ${webSearch ? `enabled (${webSearchConfig.provider})` : 'disabled'}.`);
  console.log(`Image generation: ${imageTool ? `enabled (${imageGenConfig.provider}: ${imageGenConfig.model})` : 'disabled'}.`);
});
