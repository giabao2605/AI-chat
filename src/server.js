import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getAgentToolConfig,
  getConfiguredAgentConfigs,
  getContextConfig,
  getDeepResearchConfig,
  getImageGenConfig,
  getImageInputConfig,
  getPublicConfig,
  getServerConfig,
  getWebSearchConfig,
} from './config.js';
import { CloudflareImageTool } from './cloudflare-image-tool.js';
import { createImageContextResolver } from './image-context.js';
import { OpenAICompatibleImageTool } from './image-tool.js';
import { ProfiledRoom } from './profiled-room.js';
import { RoomManager, normalizeRoomId } from './room-manager.js';
import { TavilyWebSearch } from './web-search.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const publicDir = normalize(join(__dirname, '..', 'public'));
const serverConfig = getServerConfig();
const webSearchConfig = getWebSearchConfig();
const webSearch = webSearchConfig.enabled ? new TavilyWebSearch(webSearchConfig) : null;
const deepResearchConfig = getDeepResearchConfig();
const contextConfig = getContextConfig();
const imageGenConfig = getImageGenConfig();
const imageInputConfig = getImageInputConfig();
const agentToolConfig = getAgentToolConfig();
const configuredAgents = getConfiguredAgentConfigs();

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
const imageContextResolver = imageInputConfig.enabled
  ? createImageContextResolver({ publicDir, maxImages: imageInputConfig.maxImages, maxBytes: imageInputConfig.maxBytes })
  : null;

function sendSse(res, event, payload) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

const eventNames = [
  'state', 'topic', 'meta', 'message:start', 'message:delta', 'message:done', 'message:cancelled', 'message:failed',
  'stats', 'research:start', 'research:done', 'research:error', 'parallel:batch', 'parallel:agent-status', 'debug', 'room:error',
];

const manager = new RoomManager({
  maxRooms: serverConfig.maxRooms,
  roomTtlMs: serverConfig.roomTtlMs,
  createRoom(roomId) {
    const room = new ProfiledRoom({
      agents: configuredAgents,
      hardTurnLimit: serverConfig.hardTurnLimit,
      webSearch,
      deepResearchConfig,
      contextConfig,
      imageContextResolver,
      imageTool: agentToolConfig.imageGenerationEnabled ? imageTool : null,
      maxImageToolCallsPerTurn: agentToolConfig.maxImageCallsPerTurn,
    });
    for (const eventName of eventNames) room.on(eventName, (payload) => manager.broadcast(roomId, eventName, payload, sendSse));
    room.on('error', (payload) => manager.broadcast(roomId, 'room:error', payload, sendSse));
    return room;
  },
});

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
    if (body.length > 1_000_000) throw new Error('Request body quá lớn.');
  }
  if (!body) return {};
  try { return JSON.parse(body); }
  catch { throw new Error('JSON không hợp lệ.'); }
}

function requestRoomId(req, url) {
  return normalizeRoomId(url.searchParams.get('room') || req.headers['x-room-id'] || 'default-room');
}

function cleanImagePrompt(value) {
  return String(value || '').trim().slice(0, 12000);
}

function roomIsActive(room) {
  return ['starting', 'running', 'paused', 'pausing'].includes(room.status) && Boolean(room.topic);
}

function recordImageMessage(room, prompt, attachment) {
  if (!roomIsActive(room)) {
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

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const roomId = requestRoomId(req, url);

  if (req.method === 'GET' && pathname === '/api/health') {
    const room = manager.peek(roomId);
    return json(res, 200, {
      ok: true,
      status: room?.room?.status || 'idle',
      roomId,
      roomManager: manager.stats(),
      activeAgents: Object.keys(configuredAgents),
      webSearch: Boolean(webSearch),
      deepResearch: Boolean(webSearch && deepResearchConfig.enabled),
      imageGen: Boolean(imageTool),
      imageProvider: imageTool ? imageGenConfig.provider : null,
      imageInput: Boolean(imageContextResolver),
      agentImageTool: Boolean(imageTool && agentToolConfig.imageGenerationEnabled && agentToolConfig.maxImageCallsPerTurn > 0),
    });
  }
  if (req.method === 'GET' && pathname === '/api/config') return json(res, 200, getPublicConfig());
  if (req.method === 'GET' && pathname === '/api/state') return json(res, 200, manager.get(roomId).room.snapshot());
  if (req.method === 'POST' && pathname === '/api/rooms') {
    const body = await readJson(req);
    const id = normalizeRoomId(body.roomId || `room_${randomUUID().replace(/-/g, '')}`);
    manager.get(id);
    return json(res, 201, { roomId: id });
  }

  if (req.method === 'GET' && pathname === '/api/events') {
    const record = manager.get(roomId);
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    const detach = manager.attachClient(roomId, res);
    sendSse(res, 'state', record.room.snapshot());
    req.on('close', detach);
    return;
  }

  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed.' });
  const body = await readJson(req);
  const room = manager.get(roomId).room;

  if (pathname === '/api/start') return json(res, 200, await room.start(body));
  if (pathname === '/api/continue') return json(res, 200, await room.continueFromHistory(body));
  if (pathname === '/api/pause') { room.pause(); return json(res, 200, room.snapshot()); }
  if (pathname === '/api/resume') { room.resume(); return json(res, 200, room.snapshot()); }
  if (pathname === '/api/stop') { room.stop(); return json(res, 200, room.snapshot()); }
  if (pathname === '/api/reset') { room.reset(); return json(res, 200, room.snapshot()); }
  if (pathname === '/api/message') return json(res, 200, room.addUserMessage(body.text));
  if (pathname === '/api/tools/image') {
    if (!imageTool) return json(res, 503, { error: 'Tool tạo ảnh chưa được cấu hình hoặc đang bị tắt.' });
    const prompt = cleanImagePrompt(body.prompt);
    if (!prompt) return json(res, 400, { error: 'Hãy nhập mô tả ảnh sau /img_gen.' });
    const attachment = await imageTool.generate(prompt);
    const entry = recordImageMessage(room, prompt, attachment);
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
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const target = normalize(join(publicDir, requested));
  const rel = relative(publicDir, target);
  if (rel.startsWith('..') || rel.includes(`..${sep}`)) return json(res, 403, { error: 'Forbidden.' });
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
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else await serveStatic(res, url.pathname);
  } catch (error) {
    const status = error?.code === 'PROVIDER_CIRCUIT_OPEN' ? 503 : 400;
    json(res, status, { error: error?.message || String(error) });
  }
});

const heartbeat = setInterval(() => {
  for (const record of manager.rooms.values()) {
    for (const client of record.clients) {
      try { client.write(': ping\n\n'); } catch {}
    }
  }
}, 20_000);

const cleanup = setInterval(() => manager.cleanup(), 10 * 60_000);
heartbeat.unref?.();
cleanup.unref?.();

server.on('close', () => {
  clearInterval(heartbeat);
  clearInterval(cleanup);
});

server.listen(serverConfig.port, serverConfig.host, () => {
  const active = Object.values(configuredAgents).map((agent) => `${agent.id.toUpperCase()}:${agent.name}`).join(', ') || 'none';
  console.log(`AI Conversation Lab: http://${serverConfig.host}:${serverConfig.port}`);
  console.log(`Agents: ${active}`);
  console.log(`Web search: ${webSearch ? 'enabled (tavily)' : 'disabled'}${webSearch && deepResearchConfig.enabled ? ' + deep-read' : ''}`);
  console.log(`Multi-room: enabled (max ${serverConfig.maxRooms})`);
});