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
import { RoomManager } from './room-manager.js';
import { resolveRequestRoomId } from './room-routing.js';
import { TavilyWebSearch } from './web-search.js';

// ProfiledRoom keeps the free-running parallel scheduler while adding per-agent profiles.

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
  'stats', 'research:start', 'research:done', 'research:error', 'parallel:agent-status', 'debug', 'room:error',
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
  return resolveRequestRoomId({
    multiRoomEnabled: serverConfig.multiRoomEnabled,
    queryRoomId: url.searchParams.get('room'),
    headerRoomId: req.headers['x-room-id'],
  });
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
      multiRoom: serverConfig.multiRoomEnabled,
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
  if (req.method === 'GET' && pathname === '/api/state') {
    const room = manager.get(roomId).room;
    return json(res, 200, room.snapshot());
  }
  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    manager.addClient(roomId, res);
    req.on('close', () => manager.removeClient(roomId, res));
    return;
  }

  const room = manager.get(roomId).room;
  if (req.method === 'POST' && pathname === '/api/start') {
    try { return json(res, 200, await room.start(await readJson(req))); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && pathname === '/api/message') {
    try { return json(res, 200, room.addUserMessage((await readJson(req)).text)); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && pathname === '/api/pause') {
    try { room.pause(); return json(res, 200, room.snapshot()); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && pathname === '/api/resume') {
    try { room.resume(); return json(res, 200, room.snapshot()); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && pathname === '/api/stop') {
    room.stop();
    return json(res, 200, room.snapshot());
  }
  if (req.method === 'POST' && pathname === '/api/reset') {
    return json(res, 200, room.reset());
  }
  if (req.method === 'POST' && pathname === '/api/continue') {
    try { return json(res, 200, await room.continueFromHistory(await readJson(req))); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (req.method === 'POST' && pathname === '/api/image') {
    if (!imageTool) return json(res, 503, { error: 'Image generation chưa được cấu hình.' });
    try {
      const body = await readJson(req);
      const prompt = cleanImagePrompt(body.prompt);
      if (!prompt) throw new Error('Prompt tạo ảnh trống.');
      const attachment = await imageTool.generate(prompt);
      const entry = recordImageMessage(room, prompt, attachment);
      return json(res, 200, { attachment, entry, state: room.snapshot() });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }

  return json(res, 404, { error: 'Không tìm thấy API.' });
}

function mimeType(pathname) {
  const extension = extname(pathname).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  })[extension] || 'application/octet-stream';
}

async function serveStatic(res, pathname) {
  const requestedPath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = normalize(join(publicDir, requestedPath));
  const relativePath = relative(publicDir, filePath);
  if (relativePath.startsWith('..') || relativePath.includes(`..${sep}`) || relativePath === '..') {
    return json(res, 403, { error: 'Forbidden' });
  }
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { 'content-type': mimeType(filePath), 'cache-control': 'no-cache' });
    res.end(content);
  } catch {
    json(res, 404, { error: 'Not found' });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return await serveStatic(res, url.pathname);
  } catch (error) {
    return json(res, 500, { error: error?.message || String(error) });
  }
});

server.listen(serverConfig.port, serverConfig.host, () => {
  console.log(`AI Conversation Lab running at http://${serverConfig.host}:${serverConfig.port}`);
});
