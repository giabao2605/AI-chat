# AI-Chat Project Context Handoff

> Snapshot for AI assistants and future maintainers. This file is a **project map, not a source of truth**. Before changing code, re-read the current `main` HEAD and the files relevant to the task because this repository evolves quickly.

## 1. Repository identity

- Repository: `giabao2605/AI-chat`
- Default branch: `main`
- Project name: **AI Conversation Lab**
- Primary purpose: a local web app where multiple AI agents can talk in one room while a human can observe or intervene.
- Current runtime generation: multi-agent v2 with support for **2 to 4 agents**.
- Agent A and B are required. Agent C and D are optional when fully configured.

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

- 2-4 independently configured AI agents.
- Per-agent model, API key, provider/base URL and display profile.
- Turn-based conversation mode.
- Free-running parallel conversation mode.
- Shared prompt plus per-agent prompt/profile/personality controls.
- Private agent-to-agent context that does not enter the public transcript.
- Per-agent persistent long-term memory.
- Transcript compaction / context summarization.
- Loop detection / steering guard.
- Tavily web research and optional deeper reading of top sources.
- Image generation tools and image context passed back to capable models.
- Realtime SSE streaming and per-agent status.
- Session history and resume.
- Multi-room support with a feature flag.
- Inspector/debug metadata.
- Conversation forking.
- Conversation presets such as debate, brainstorming, code review, fact-check and Socratic modes.
- IndexedDB + localStorage browser persistence.
- Markdown rendering and math rendering.
- Dark UI with a light-blue accent layer.

## 4. Backend file map

### `src/server.js`

Main backend entrypoint.

Responsibilities include:

- Build the Node HTTP server.
- Serve static frontend files from `public/`.
- Create and manage rooms through `RoomManager`.
- Wire SSE events to connected clients.
- Build web-search, memory and image-tool services from config.
- Expose the main HTTP API.

Important routes currently include:

- `GET /api/health`
- `GET /api/config`
- `GET /api/state`
- `POST /api/rooms`
- `GET /api/events`
- `POST /api/start`
- `POST /api/continue`
- `POST /api/pause`
- `POST /api/resume`
- `POST /api/stop`
- `POST /api/reset`
- `POST /api/message`
- `POST /api/tools/image`

### `src/config.js`

Central environment/config parser.

Covers:

- Agent A/B/C/D configuration.
- Provider base URL and timeout.
- Server host/port.
- Multi-room settings.
- Web search / Tavily settings.
- Deep research settings.
- Context summarization settings.
- Long-term memory settings.
- Image generation and model image-input settings.
- Agent tool settings.
- Public config returned to the frontend.

### `src/provider.js`

OpenAI-compatible provider layer.

Key behavior:

- Uses `/chat/completions` style endpoints.
- Supports streaming.
- Normalizes tool calls.
- Handles multimodal/image input when supported.
- Falls back to text-only behavior when vision is rejected.
- Tracks exact usage when the provider returns usage, otherwise estimates it.
- Includes request timeout handling.
- Includes a circuit breaker after repeated provider failures.

### `src/multi-agent-room.js`

Primary multi-agent runtime logic.

Treat this as one of the main files to inspect for conversation scheduling, agent state and shared room behavior.

### `src/parallel-batch-room.js`

Parallel/free-running conversation implementation.

The class/file name is partly legacy: current semantics are free-running rather than strict barrier batches. Do not infer behavior purely from the filename.

### `src/orchestrator.js`

Conversation orchestration and coordination logic. Inspect this when changing agent scheduling, context assembly, research/tool integration or turn behavior.

### `src/profiled-room.js`

Adds agent profile/prompt behavior on top of room execution.

### `src/memory-profiled-room.js`

Integrates long-term memory with profiled multi-agent rooms.

### `src/memory-store.js`

SQLite-backed persistent memory store.

### `src/agent-memory.js`

Per-agent long-term memory manager, including retrieval and consolidation logic.

Memory is intended to remain isolated by agent unless config says otherwise.

### `src/web-search.js`

Tavily search client and search-related utilities.

### `src/research.js`

Research planning / aggregation logic.

### `src/deep-research.js`

Optional deeper reading of selected sources. Web content should be treated as untrusted evidence, not as system instructions.

### Image/tool files

- `src/agent-tools.js`
- `src/image-tool.js`
- `src/cloudflare-image-tool.js`
- `src/image-context.js`

These cover native agent tools, image generation providers and feeding images back into model context.

### Room/session support

- `src/room-manager.js`
- `src/room-routing.js`
- `src/resumable-room.js`
- `src/conversation-end.js`

Inspect these for room lifecycle, room IDs, resume behavior and end-of-conversation logic.

## 5. Frontend file map

Frontend code lives in `public/`.

Important files include:

- `public/index.html` - main page shell.
- `public/app.js` - primary frontend application logic.
- `public/lab-v2.js` - v2 runtime/UI integration.
- `public/agent-profiles.js` - per-agent profile controls.
- `public/parallel-stream-ui.js` - live parallel-agent UI/status behavior.
- `public/prompt-settings.js` / `public/prompt-ui.js` - prompt persistence and editing.
- `public/control-settings.js` / `public/control-ui.js` - control-room behavior.
- `public/history.js` - browser chat-history persistence.
- `public/history-resume.js` / `public/history-resume-ui.js` - history restore/resume.
- `public/image-command.js` / `public/image-tool-ui.js` - image command/UI integration.
- `public/markdown.js` / `public/markdown-ui.js` - Markdown rendering.
- `public/math-renderer.js` - math rendering integration.
- `public/research-status.js` - research state/status UI.
- `public/room-session.js` - client room/session behavior.

Relevant CSS layers include:

- `public/styles.css`
- `public/ui-v3.css`
- `public/sidebar-v3.css`
- `public/layout-v2.css`
- `public/lab-v2.css`
- `public/modern-theme.css`
- `public/light-blue-theme.css`
- `public/chat-v4.css`
- `public/parallel-stream-ui.css`
- `public/image-tool.css`
- `public/markdown.css`

Several CSS files intentionally layer on top of older styles instead of rewriting everything. Check load order in `index.html` before deleting or consolidating styles.

## 6. Configuration baseline

See `.env.example` for the current public example.

At the time this handoff file was created, the public example used approximately this shape:

- Provider example: `https://api.proxyllm.eu/v1`
- Four example agents using `gpt-5.6-luna`
- `MULTI_ROOM_ENABLED=false`
- Tavily web search enabled when a key is present.
- Deep web research enabled.
- Agent memory enabled.
- Default memory DB: `./data/agent-memory.sqlite`
- Default memory scope: `agent`
- Image provider example: Cloudflare.
- Image generation itself disabled by default.
- Model image input enabled by default.
- Agent image tool enabled when image generation is actually configured.

Never commit real API keys, Cloudflare credentials, local memory databases or `.env`.

## 7. Memory model

The current long-term memory design is intentionally simple and isolated.

Important concepts:

- Persistent per-agent memory.
- SQLite storage.
- Memory retrieval is bounded instead of loading the entire store.
- Memory can be scoped by agent or room depending on config.
- Private context can be persisted without exposing it to unrelated agents.
- Long-term consolidation is separated from normal visible transcript context.
- Transcript summarization is short-term/working context, not the same thing as persistent memory.

When changing memory behavior, inspect both:

- `src/agent-memory.js`
- `src/memory-store.js`
- `src/memory-profiled-room.js`

Also run the memory-related regression tests.

## 8. Parallel conversation semantics

Do not assume old round/barrier behavior.

The newer parallel mode is designed so that agents can run independently. A free agent may start another response when new unseen input appears, without waiting for all other agents to finish first. At most one response should be actively running per agent.

The historical filename `parallel-batch-room.js` remains for compatibility, but the implementation evolved beyond literal batch rounds.

## 9. Private context model

Agents can send private context to selected other agents.

Security/isolation intent:

- Private content must not enter the shared/public transcript.
- Unrelated agents must not receive private content in their model payload.
- Public/debug metadata should not expose secret contents.
- Resume/persistence should preserve intended private state.

When touching this area, inspect private-context regression tests before modifying behavior.

## 10. Browser persistence

The frontend uses browser persistence for several user-facing features.

Current concepts include:

- localStorage for lightweight UI/session settings and chat history.
- IndexedDB as a larger snapshot/persistence layer for v2 rooms.
- Tombstones for deleted browser history so deleted conversations are not resurrected by later state snapshots or resume logic.

Be careful with startup order and persistence races. Several past bugs involved saved settings/history being overwritten during reload.

## 11. Testing and CI

GitHub Actions workflow:

```text
.github/workflows/ci.yml
```

Current CI runs on Node 22 and executes:

```bash
npm test
npm run check
```

The `test/` directory contains broad regression coverage for backend and frontend utilities, including areas such as:

- agent config and profiles
- memory
- private context
- provider streaming/tools/vision
- orchestration
- parallel mode
- web research
- history and resume
- prompt/settings persistence
- image generation/context/UI
- Markdown/math rendering
- room flags and layout behavior

Before merging changes, run both `npm test` and `npm run check` unless the task explicitly cannot be executed locally.

## 12. Recent architecture history

Important merged milestones immediately before this handoff was created:

- PR #26: multi-agent v2 foundation.
- PR #37: free-running parallel conversation behavior.
- PR #39: isolated private agent-to-agent context.
- PR #40 / #41: modern dark visual refresh and light-blue accent.
- PR #42: reorganized four-agent Luna `.env.example`.
- PR #44: persistent per-agent long-term memory foundation.
- PR #45: fixed deleted browser chat history reappearing.

This history matters because some filenames and compatibility layers reflect older implementations.

## 13. Snapshot at handoff creation

Handoff created on **2026-09-15**.

At that time:

- `main` HEAD: `e6b0981f23c38bb4ed86d79c9de8b04ad4aeff66`
- Commit title: `Fix deleted chat history reappearing`
- The GitHub Actions CI run for that HEAD completed successfully.
- No open pull request was found in the checked repository state.
- No open issue was found in the checked repository state.

This snapshot will become stale. Always verify current HEAD, open PRs/issues and relevant files before making a new change.

## 14. Guidance for another AI assistant

When a user asks you to work on this repo:

1. Treat `giabao2605/AI-chat` as the intended project unless the user explicitly names another repo.
2. Read the current repository metadata and `main` HEAD first.
3. Read only the files relevant to the requested change, but include tests for that subsystem.
4. Do not trust this handoff blindly if current code disagrees with it.
5. Preserve existing isolation guarantees for rooms, agents, memory and private context.
6. Preserve the lightweight Node-core architecture unless the requested feature clearly justifies a new dependency.
7. Do not commit secrets, `.env`, generated memory databases or credentials.
8. Prefer adding/updating regression tests for bug fixes and behavior changes.
9. Run or verify `npm test` and `npm run check` before considering a code change complete.
10. For GitHub mutations, prefer a branch + PR for substantial changes unless the user explicitly asks for a direct change on `main`.

## 15. Quick routing guide

If the user asks about...

- **Server/API/SSE:** start with `src/server.js`.
- **Agent/provider/model streaming:** start with `src/provider.js` and `src/config.js`.
- **Who speaks next / scheduling:** inspect `src/multi-agent-room.js`, `src/orchestrator.js`, `src/parallel-batch-room.js`.
- **Agent profiles/prompts:** inspect `src/profiled-room.js`, `public/agent-profiles.js`, prompt UI files.
- **Long-term memory:** inspect `src/agent-memory.js`, `src/memory-store.js`, `src/memory-profiled-room.js`.
- **Private agent messages:** inspect multi-agent/profiled room logic and `test/private-context-room.test.js`.
- **Web research:** inspect `src/web-search.js`, `src/research.js`, `src/deep-research.js`.
- **Images:** inspect image-tool/context files plus `public/image-tool-ui.js`.
- **History/resume:** inspect `public/history.js`, `public/history-resume.js`, room resume logic.
- **UI layout/theme:** inspect `public/index.html` and the later-loaded CSS layers before editing base CSS.
- **Markdown/math rendering:** inspect `public/markdown.js`, `public/markdown-ui.js`, `public/math-renderer.js`.

---

Keep this file concise enough to remain useful. Update it only when architecture, major feature boundaries or repository operating conventions materially change.