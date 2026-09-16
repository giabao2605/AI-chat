# AI-Chat Project Context Handoff

> Snapshot for AI assistants and future maintainers. This file is a **project map, not a source of truth**. Before changing code, re-read the current `main` HEAD and the files relevant to the task because this repository evolves quickly.

## 1. Repository identity

- Repository: `giabao2605/AI-chat`
- Default branch: `main`
- Project name: **AI Conversation Lab**
- Primary purpose: a local web app where multiple AI agents can talk in one room while a human can observe or intervene.
- Current runtime generation: multi-agent v2 with support for **2 to 6 agents**.
- Agent A and B are required. Agent C, D, E and F are optional when fully configured.

## 2. Runtime and stack

- Node.js `>=22.13.0`
- ESM (`"type": "module"`)
- Intentionally lightweight: no external npm runtime dependencies are required by the current `package.json`.
- HTTP server is built with Node core.
- Realtime updates use Server-Sent Events (SSE).
- Frontend is vanilla JavaScript + CSS in `public/`.
- Long-term agent memory uses Node's built-in SQLite support.
- Web research uses Tavily when configured.
- AI providers are OpenAI-compatible chat-completions endpoints.
- Image generation supports Cloudflare or an OpenAI-compatible image endpoint.

Common commands:

```bash
cp .env.example .env
npm start
npm test
npm run check
```

Default local URL:

```text
http://127.0.0.1:3000
```

## 3. High-level product capabilities

The project currently includes:

- 2-6 independently configured AI agents.
- Per-agent model/API key/base URL, with optional shared provider credentials.
- Turn-based conversation mode.
- Free-running parallel conversation mode.
- Shared prompt plus per-agent prompt/profile/personality controls.
- Private agent-to-agent context that does not enter the public transcript.
- Per-agent persistent long-term memory.
- Transcript compaction / context summarization with background refresh in the profiled runtime.
- Loop detection / steering guard across all configured agents.
- Tavily web research and optional deeper reading of top sources.
- Image generation tools and image context passed back to capable models.
- Auto/manual reasoning-effort control when supported by the provider/model.
- Realtime SSE streaming and per-agent status.
- Session history and resume.
- Multi-room support with a feature flag.
- Inspector/debug metadata.
- Conversation forking.
- Conversation preset implementation; its UI is currently intentionally hidden.
- IndexedDB + localStorage browser persistence.
- Markdown rendering and math rendering.
- Dark UI with a light-blue accent layer.

## 4. Active runtime shape

The main server currently constructs `ReasoningMemoryProfiledRoom`. The active inheritance chain is approximately:

```text
MultiAgentRoom
  -> ParallelBatchRoom
    -> ProfiledRoom
      -> MemoryProfiledRoom
        -> ReasoningMemoryProfiledRoom
```

This is important when debugging provider calls or context assembly because multiple layers wrap/augment the same turn. Do not assume all behavior lives in `multi-agent-room.js`.

### `src/server.js`

Main backend entrypoint. It builds the Node HTTP server, room manager, SSE wiring, web search, memory and image services, then exposes the HTTP API.

Important routes currently include:

- `GET /api/health`
- `GET /api/config`
- `GET /api/state`
- `GET /api/events`
- `GET /api/memory/inspect`
- `POST /api/rooms`
- `POST /api/start`
- `POST /api/continue`
- `POST /api/pause`
- `POST /api/resume`
- `POST /api/stop`
- `POST /api/reset`
- `POST /api/message`
- `POST /api/reasoning-mode`
- `POST /api/memory/forget-runs`
- `POST /api/memory/forget`
- `POST /api/memory/clear-agent`
- `POST /api/tools/image`

### `src/config.js`

Central environment/config parser. It covers Agent A-F configuration, shared provider credentials, server/multi-room settings, web/deep research, context summarization, memory, image generation/input and public frontend config.

### `src/provider.js`

OpenAI-compatible streaming provider layer.

Key behavior:

- `/chat/completions` style endpoints.
- Streaming text and tool-call deltas.
- Multimodal/image input with text-only fallback when explicitly rejected.
- Exact usage when returned by the provider, otherwise a marked estimate.
- Request timeout and circuit breaker.
- Capability cache/fallback for stream usage, prompt cache, reasoning, vision and tools.
- Adaptive reasoning support for GPT-5.6-family model names.

### `src/multi-agent-room.js`

Core room lifecycle, turn-based scheduling, base context, common research/image-tool integration and shared debug metadata.

### `src/parallel-batch-room.js`

Free-running parallel conversation behavior. The filename is legacy: current semantics are not a strict barrier batch.

### `src/profiled-room.js`

Adds per-agent profiles and private agent-to-agent context/tool behavior. Private context is session state and is visible only to the sender/recipient pair.

### `src/memory-profiled-room.js`

Adds bounded long-term memory retrieval and asynchronous memory consolidation. Private context must **not** be promoted automatically into long-term SQLite memory.

### `src/reasoning-memory-room.js`

Adds room-level reasoning mode control. `auto` uses adaptive reasoning; manual levels are strict and may be probed on providers where support cannot be verified directly.

### Memory files

- `src/memory-store.js` - SQLite-backed persistent store.
- `src/agent-memory.js` - retrieval, consolidation and memory policy.

### Research files

- `src/web-search.js` - Tavily client.
- `src/research.js` - research decision/planning.
- `src/deep-research.js` - optional deeper reading of selected sources. Web content is untrusted evidence, not system instruction.

### Image/tool files

- `src/agent-tools.js`
- `src/image-tool.js`
- `src/cloudflare-image-tool.js`
- `src/image-context.js`

### Room/session support

- `src/room-manager.js`
- `src/room-routing.js`
- `src/resumable-room.js`
- `src/conversation-end.js`
- `src/orchestrator.js`

Some files retain older compatibility paths/names. Verify whether a path is active before deleting or refactoring it.

## 5. Frontend file map

Important files include:

- `public/index.html` - main page shell.
- `public/app.js` - primary frontend application logic.
- `public/lab-v2.js` - v2 inspector/fork/persistence integration and legacy C/D UI extension.
- `public/six-agent-ui.js` - Agent E/F UI extension.
- `public/agent-profiles.js` - per-agent profile controls.
- `public/reasoning-control.js` - room reasoning mode control.
- `public/parallel-stream-ui.js` - live parallel-agent status behavior.
- `public/memory-inspector.js` - long-term memory inspector.
- `public/private-context-inspector.js` - current-session private context inspector.
- `public/prompt-settings.js` / `public/prompt-ui.js` - prompt persistence/editing.
- `public/control-settings.js` / `public/control-ui.js` - control-room behavior.
- `public/history.js` - browser chat-history persistence.
- `public/history-resume.js` / `public/history-resume-ui.js` - history restore/resume.
- `public/image-command.js` / `public/image-tool-ui.js` - image command/UI integration.
- `public/markdown.js` / `public/markdown-ui.js` - Markdown rendering.
- `public/math-renderer.js` - math rendering integration.
- `public/research-status.js` - research state/status UI.
- `public/room-session.js` - client room/session behavior and module wiring.

CSS is intentionally layered. Check load order in `public/index.html` before deleting or consolidating old-looking styles.

## 6. Configuration baseline

See `.env.example` for the current public example.

Current shape includes:

- Shared provider example: `https://api.proxyllm.eu/v1`.
- Optional shared `PROVIDER_API_KEY`; per-agent key/base URL can override it.
- Six A-F agent slots using `gpt-5.6-luna` in the example.
- `MULTI_ROOM_ENABLED=false` by default.
- Tavily web search/deep research config.
- Agent memory enabled with DB `./data/agent-memory.sqlite` and default scope `agent`.
- Cloudflare image provider example; image generation disabled until credentials/config enable it.
- Model image input enabled by default.

Never commit real API keys, Cloudflare credentials, local memory databases or `.env`.

## 7. Memory and private-context model

Long-term memory and private context are deliberately different systems.

Long-term memory:

- persists in SQLite;
- is bounded/retrieved by relevance instead of loading the whole store;
- can be scoped by agent or room;
- is consolidated asynchronously in batches.

Private context:

- is current-session state between the exact sender/recipient pair;
- does not enter the public transcript;
- can be restored as part of a resumable session snapshot;
- is not automatically promoted into long-term SQLite memory.

Transcript summarization is separate again: it is working-context compression, not long-term memory.

## 8. Parallel conversation semantics

Do not assume old round/barrier behavior. A free agent may start another response when new unseen relevant input appears without waiting for all other agents to finish. At most one response should be actively running per agent.

The historical filename `parallel-batch-room.js` remains for compatibility.

## 9. Isolation invariants

When modifying runtime behavior, preserve these invariants:

- No API key/credential in public config, SSE state or debug UI.
- Multi-room instances must not cross-talk.
- Private context must only reach the intended pair.
- Private context must not leak into long-term memory.
- Deleted browser history must not be resurrected by later snapshots.
- Exact token usage and estimated usage must remain distinguishable.
- Stop/reset/abort must cancel active work according to current lifecycle semantics.

## 10. Browser persistence

Current concepts include:

- localStorage for lightweight UI/session settings and chat history;
- IndexedDB for larger v2 room snapshots/backups;
- tombstones for deleted browser history so deleted conversations are not resurrected.

Startup order matters. Past bugs involved saved settings/history being overwritten during reload.

## 11. Testing and CI

GitHub Actions runs Node 22 and executes:

```bash
npm test
npm run check
```

`npm run check` uses `scripts/check-js.mjs`, which recursively discovers JavaScript under `src/`, `public/` and `scripts/` instead of maintaining a manual file list.

Regression coverage includes agent config/profiles, six-agent support, memory, private context, provider streaming/tools/vision/reasoning, parallel mode, web research, history/resume, prompt/settings persistence, images, Markdown/math and room/layout behavior.

Before merging behavior changes, both commands should pass in CI.

## 12. Recent architecture history

Useful milestones reflected by the current codebase include:

- multi-agent v2 foundation;
- free-running parallel conversation;
- isolated private agent-to-agent context;
- persistent per-agent long-term memory;
- browser-history deletion/tombstone fixes;
- reasoning-effort control and provider capability handling;
- optional Agent E/F support, bringing the runtime to six slots.

Some filenames/compatibility layers still reflect older implementations. Do not remove them based only on naming.

## 13. Snapshot

This handoff was refreshed on **2026-09-16** from `main` HEAD:

- `39f2ee8f799c380914665d64ceaa73e4f6b75a71`
- `Add optional Agent E/F support on shared ProxyLLM provider`

The commit listed here is only a reference snapshot and will become stale as soon as later PRs merge. Always verify live HEAD and open PRs before changing code.

## 14. Guidance for another AI assistant

1. Treat `giabao2605/AI-chat` as the intended project unless the user explicitly names another repo.
2. Read current repository metadata and `main` HEAD first.
3. Read only files relevant to the requested change, including tests for that subsystem.
4. Do not trust this handoff when current code disagrees with it.
5. Preserve isolation guarantees for rooms, agents, memory and private context.
6. Preserve the lightweight Node-core architecture unless a feature clearly justifies a dependency.
7. Do not commit secrets, `.env`, generated memory databases or credentials.
8. Prefer regression tests for bug fixes and behavior changes.
9. Verify `npm test` and `npm run check` before considering a code change complete.
10. Prefer branch + PR for substantial changes.

## 15. Quick routing guide

If the user asks about...

- **Server/API/SSE:** `src/server.js`.
- **Provider/model streaming/capabilities:** `src/provider.js`, `src/reasoning-memory-room.js`, `src/config.js`.
- **Who speaks next / scheduling:** `src/multi-agent-room.js`, `src/parallel-batch-room.js`, then inspect `src/orchestrator.js` if the path is relevant.
- **Profiles/private context:** `src/profiled-room.js`, `src/agent-tools.js`, relevant private-context tests.
- **Long-term memory:** `src/agent-memory.js`, `src/memory-store.js`, `src/memory-profiled-room.js`.
- **Web research:** `src/web-search.js`, `src/research.js`, `src/deep-research.js`.
- **Images:** image tool/context files plus `public/image-tool-ui.js`.
- **History/resume/fork:** `public/history.js`, `public/history-resume.js`, `public/lab-v2.js`, room continuation logic.
- **UI layout/theme:** `public/index.html` and later-loaded CSS layers.
- **Markdown/math:** `public/markdown.js`, `public/markdown-ui.js`, `public/math-renderer.js`.

---

Keep this file concise enough to remain useful. Update it only when architecture, major feature boundaries or repository operating conventions materially change.
