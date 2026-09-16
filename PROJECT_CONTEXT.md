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
- Per-agent input context budgeting.
- Loop detection / steering guard across all configured agents.
- Tavily web research and optional deeper reading of top sources.
- Image generation tools and image context passed back to capable models.
- Auto/manual reasoning-effort control when supported by the provider/model.
- Provider scheduling/rate-limit coordination and retry/backoff diagnostics.
- Per-turn token anatomy / performance diagnostics.
- Deterministic backend scenario engine; Werewolf/Ma Sói is the current game scenario.
- Realtime SSE streaming and per-agent status.
- Session history and resume/fork.
- Multi-room support with a feature flag.
- Inspector/debug metadata.
- Conversation preset implementation; its UI is currently intentionally hidden.
- IndexedDB + localStorage browser persistence.
- Markdown rendering and math rendering.
- Dark UI with a light-blue accent layer.

## 4. Active runtime shape

The main server constructs `ScenarioRoom`. The active inheritance chain is:

```text
MultiAgentRoom
  -> ParallelBatchRoom
    -> ProfiledRoom
      -> MemoryProfiledRoom
        -> ReasoningMemoryProfiledRoom
          -> ScenarioRoom
```

Task 5 moved the most coupled turn concerns behind composition boundaries without forcing a risky full hierarchy rewrite:

- `TurnCoordinator` owns scheduling decisions.
- `ContextAssembler` owns base message assembly, context placement and budget application semantics.
- `AgentExecutor` owns provider streaming, first-token/message events, image-tool execution loops, usage aggregation and cancellation/failure signaling.

The active server path uses those components through the room chain. Profile/private-context, memory, reasoning and scenario behavior remain layered because flattening them further would currently increase migration risk more than it reduces complexity.

The old standalone `ConversationRoom` / `ResumableConversationRoom` runtime was removed after its remaining regression coverage was migrated to the active path.

### `src/server.js`

Main backend entrypoint. It builds the Node HTTP server, room manager, SSE wiring, web search, memory and image services, then exposes the HTTP API. It constructs `ScenarioRoom` for live rooms.

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

Central environment/config parser. It covers Agent A-F configuration, shared provider credentials, server/multi-room settings, web/deep research, context summarization/budgeting, memory, image generation/input and public frontend config.

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

### `src/provider-scheduler.js`

Coordinates provider concurrency/rate-limit behavior and exposes queue/retry timing used by diagnostics.

### `src/multi-agent-room.js`

Core room lifecycle, sequential loop, history/state, common research/image support and lower-level fallback behavior. Do not assume all active turn execution lives here: the server path is augmented by the layers/components below.

### `src/parallel-batch-room.js`

Free-running parallel conversation behavior. The filename is legacy: current semantics are not a strict barrier batch. Parallel scheduling decisions delegate to `TurnCoordinator`.

### `src/turn-coordinator.js`

Pure scheduling-decision component used for speaker selection, rotating parallel order, unseen-trigger checks, slot eligibility and completion decisions.

### `src/context-assembler.js`

Central context/message assembly component. It handles base agent messages, multimodal history representation, memory/private/scenario placement rules and context-budget application. It does not perform memory retrieval, web I/O or provider calls.

### `src/agent-executor.js`

Executes a prepared agent turn against the already-wrapped provider. It owns streaming events, provider-call diagnostics, usage merging, image-tool loops and cancellation/failure signaling. It does not own room scheduling, memory retrieval or research planning.

### `src/profiled-room.js`

Adds per-agent profiles and private agent-to-agent context/tool behavior. Private context is session state and is visible only to the sender/recipient pair.

### `src/memory-profiled-room.js`

Adds bounded long-term memory retrieval and asynchronous memory consolidation. Private context must **not** be promoted automatically into long-term SQLite memory.

### `src/reasoning-memory-room.js`

Adds room-level reasoning mode control and the active turn orchestration that combines context/research preparation with `AgentExecutor`. `auto` uses adaptive reasoning; manual levels are strict and may be probed on providers where support cannot be verified directly.

### Scenario/game files

- `src/scenario-room.js` - active top-level room and scenario integration.
- `src/scenario.js` - deterministic scenario controller/contracts.
- `src/werewolf-scenario.js` - Werewolf/Ma Sói rules/state machine.

Scenario secret state must never enter the public transcript, public SSE snapshot or long-term memory consolidation.

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
- `src/scenario-room.js`
- `src/conversation-end.js` - currently a standalone/dormant conversation-end utility, not part of the active server turn loop.

`src/orchestrator.js` and `src/resumable-room.js` were removed in Task 5 after active-path coverage replaced their legacy test consumers.

## 5. Frontend file map

Important files include:

- `public/index.html` - main page shell.
- `public/app.js` - primary frontend application logic.
- `public/lab-v2.js` - v2 inspector/fork/persistence integration and some legacy UI extension code.
- `public/six-agent-ui.js` - Agent E/F UI extension.
- `public/agent-profiles.js` - per-agent profile controls.
- `public/reasoning-control.js` - room reasoning mode control.
- `public/parallel-stream-ui.js` - live parallel-agent status behavior.
- `public/memory-inspector.js` - long-term memory inspector.
- `public/private-context-inspector.js` - current-session private context inspector.
- `public/profiler-ui.js` - turn/token/performance diagnostics.
- `public/prompt-settings.js` / `public/prompt-ui.js` - prompt persistence/editing.
- `public/control-settings.js` / `public/control-ui.js` - control-room behavior.
- `public/history.js` - browser chat-history persistence.
- `public/history-resume.js` / `public/history-resume-ui.js` - history restore/resume.
- `public/image-command.js` / `public/image-tool-ui.js` - image command/UI integration.
- `public/markdown.js` / `public/markdown-ui.js` - Markdown rendering.
- `public/math-renderer.js` - math rendering integration.
- `public/research-status.js` - research state/status UI.
- `public/scenario-ui.js` - scenario selection/state UI.
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

The historical filename `parallel-batch-room.js` remains for compatibility, but scheduling decisions are centralized in `TurnCoordinator`.

## 9. Resume/history semantics

Normal historical conversation resume/fork runs through the active room continuation path and creates a new runtime `runId` rather than resurrecting the old run identity.

If the historical transcript has already consumed its selected `maxTurns`, the caller must explicitly increase the cap before continuing. `ScenarioRoom.continueFromHistory` rejects an exhausted cap with `RESUME_TURN_LIMIT_REACHED`; this matches `public/history-resume.js` / UI behavior.

Scenario sessions with secret state are currently not resumable/forkable because secret state is intentionally not persisted into public history.

## 10. Isolation invariants

When modifying runtime behavior, preserve these invariants:

- No API key/credential in public config, SSE state or debug UI.
- Multi-room instances must not cross-talk.
- Private context must only reach the intended pair.
- Private context must not leak into long-term memory.
- Deleted browser history must not be resurrected by later snapshots.
- Exact token usage and estimated usage must remain distinguishable.
- Stop/reset/abort must cancel active and queued work according to current lifecycle semantics.
- Scenario/game secrets must not enter public transcript, public SSE state or long-term memory.

## 11. Browser persistence

Current concepts include:

- localStorage for lightweight UI/session settings and chat history;
- IndexedDB for larger v2 room snapshots/backups;
- tombstones for deleted browser history so deleted conversations are not resurrected.

Startup order matters. Past bugs involved saved settings/history being overwritten during reload.

## 12. Testing and CI

GitHub Actions runs Node 22 and executes:

```bash
npm test
npm run check
```

`npm run check` uses `scripts/check-js.mjs`, which recursively discovers JavaScript under `src/`, `public/` and `scripts/` instead of maintaining a manual file list.

Regression coverage includes active runtime lifecycle, TurnCoordinator, ContextAssembler, AgentExecutor, agent config/profiles, six-agent support, memory, private context, provider streaming/tools/vision/reasoning/rate limits, parallel mode, scenarios, web research, history/resume, prompt/settings persistence, images, Markdown/math and room/layout behavior.

Before merging behavior changes, both commands should pass in CI.

## 13. Recent architecture history

Useful milestones reflected by the current codebase include:

- multi-agent v2 foundation and optional Agent E/F support;
- free-running parallel conversation;
- isolated private agent-to-agent context;
- persistent per-agent long-term memory;
- token anatomy/performance profiling and context budgeting;
- provider scheduler/rate-limit coordination;
- deterministic scenario engine with Werewolf/Ma Sói;
- Task 5 runtime cleanup: characterization tests, `TurnCoordinator`, `ContextAssembler`, `AgentExecutor`, active-path test migration and removal of the old `ConversationRoom` / `ResumableConversationRoom` runtimes.

The active inheritance chain still exists for profile/private-context, memory, reasoning and scenario responsibilities. Further flattening should only be attempted when it removes real coupling; do not create abstraction churn merely to reduce the number of arrows in a diagram.

## 14. Snapshot

This handoff was refreshed on **2026-09-16** from `main` HEAD:

- `cea71f3418d1e69a6ee91bcf4245393f9f3ba3ad`
- `Task 5.5b: remove legacy conversation runtimes`

The commit listed here is only a reference snapshot and will become stale as soon as later PRs merge. Always verify live HEAD and open PRs before changing code.

## 15. Guidance for another AI assistant

1. Treat `giabao2605/AI-chat` as the intended project unless the user explicitly names another repo.
2. Read current repository metadata and `main` HEAD first.
3. Read only files relevant to the requested change, including tests for that subsystem.
4. Do not trust this handoff when current code disagrees with it.
5. Preserve isolation guarantees for rooms, agents, memory, private context and scenario secrets.
6. Preserve the lightweight Node-core architecture unless a feature clearly justifies a dependency.
7. Do not commit secrets, `.env`, generated memory databases or credentials.
8. Prefer regression tests for bug fixes and behavior changes.
9. Verify `npm test` and `npm run check` before considering a code change complete.
10. Prefer branch + PR for substantial changes.

## 16. Quick routing guide

If the user asks about...

- **Server/API/SSE:** `src/server.js`, `src/scenario-room.js`.
- **Who speaks next / scheduling:** `src/turn-coordinator.js`, `src/parallel-batch-room.js`, `src/multi-agent-room.js`.
- **Context assembly / token budget:** `src/context-assembler.js`, then the profile/memory/scenario layer that contributes the relevant context.
- **Provider execution / streaming / image-tool loop:** `src/agent-executor.js`, `src/reasoning-memory-room.js`, `src/provider.js`.
- **Provider queue/rate limits:** `src/provider-scheduler.js`, `src/provider.js`.
- **Profiles/private context:** `src/profiled-room.js`, `src/agent-tools.js`, relevant private-context tests.
- **Long-term memory:** `src/agent-memory.js`, `src/memory-store.js`, `src/memory-profiled-room.js`.
- **Web research:** `src/web-search.js`, `src/research.js`, `src/deep-research.js`.
- **Scenario/game rules:** `src/scenario-room.js`, `src/scenario.js`, `src/werewolf-scenario.js`.
- **Images:** `src/agent-executor.js`, image tool/context files, `public/image-tool-ui.js`.
- **History/resume/fork:** `src/scenario-room.js`, `src/multi-agent-room.js`, `public/history.js`, `public/history-resume.js`, `public/lab-v2.js`.
- **UI layout/theme:** `public/index.html` and later-loaded CSS layers.
- **Markdown/math:** `public/markdown.js`, `public/markdown-ui.js`, `public/math-renderer.js`.

---

Keep this file concise enough to remain useful. Update it only when architecture, major feature boundaries or repository operating conventions materially change.
