# AI Conversation Lab v2

Runtime v2 giữ UI/logic tương thích nhưng orchestration hiện hỗ trợ 2-6 AI và đã có thêm profiler, context budget, provider scheduler cùng Scenario Engine.

## Agent C-F

Agent A và B vẫn bắt buộc. C, D, E và F là tùy chọn: cấu hình model cùng API key/base URL riêng hoặc dùng `PROVIDER_API_KEY` / `PROVIDER_BASE_URL` chung trong `.env`. Khi agent được cấu hình đầy đủ, runtime và UI đưa agent đó vào phòng, token stats, private context và lựa chọn người mở lời.

## Active runtime

Server tạo `ScenarioRoom`. Chuỗi room hiện tại là:

```text
MultiAgentRoom
  -> ParallelBatchRoom
    -> ProfiledRoom
      -> MemoryProfiledRoom
        -> ReasoningMemoryProfiledRoom
          -> ScenarioRoom
```

Task 5 không rewrite toàn hierarchy. Thay vào đó, các concern nặng đã được tách ra component riêng:

- `TurnCoordinator`: speaker/parallel scheduling decisions.
- `ContextAssembler`: base messages, placement của memory/private/scenario context và budget semantics.
- `AgentExecutor`: provider streaming, provider-call diagnostics, usage merge, cancellation và image-tool loop.

`src/orchestrator.js` và `src/resumable-room.js` legacy đã được xóa sau khi regression coverage được migrate sang active path.

## Multi-room

Khi `MULTI_ROOM_ENABLED=true`, mỗi tab browser nhận một `roomId` riêng trong `sessionStorage`. Mọi `/api/*` và SSE event được gắn room id, vì vậy các room không điều khiển chung một singleton. Server dọn room không hoạt động theo `ROOM_TTL_MS` và giới hạn số room bằng `MAX_ROOMS`.

## Context manager và budget

Khi transcript vượt `CONTEXT_SUMMARIZE_AFTER`, phần cũ được nén thành conversation summary. Bản summary trong profiled runtime có provisional digest tức thời và refresh nền để tránh chặn lượt chính. Loop guard áp dụng cho toàn bộ agent đang cấu hình A-F.

Request chính của agent còn đi qua context budget deterministic:

- `CONTEXT_INPUT_BUDGET_TOKENS` mặc định 12000; `0` để tắt.
- Có safety margin, image token reserve và per-agent override.
- System/topic/latest recent context được bảo vệ; optional context cũ bị prune theo policy cố định.
- Nếu mandatory context tự vượt target, runtime giữ nguyên thay vì cắt mù và Inspector báo trạng thái over-budget.
- Helper calls như summary/research planning/memory consolidation không bị kéo vào budget path chính.

## Long-term memory và private context

Long-term memory được lưu bằng SQLite và truy xuất theo agent/room tùy cấu hình. Private context là state riêng của phiên giữa đúng sender/recipient; nó không đi vào transcript chung và không được tự động promote thành long-term memory.

## Web research

Tavily lập plan/search và có thể đọc sâu top source (`WEB_RESEARCH_DEEP_*`). Evidence được đưa vào role `user` bên trong `<untrusted_web_evidence>`, không ghép nội dung website vào system prompt.

Trong Scenario Engine, research planning diễn ra trước khi secret scenario context được inject, nên role/secret không đi vào web query.

## Provider scheduler và resilience

OpenAI-compatible provider có timeout, capability fallback có kiểm soát, circuit breaker và scheduler dùng chung toàn process.

- Pool group theo normalized endpoint + hashed credential identity, không expose raw API key.
- `PROVIDER_MAX_CONCURRENT_REQUESTS` mặc định 3; `0` = unlimited.
- Queue timeout tách khỏi provider fetch timeout.
- Stop/abort loại queued work ra ngay.
- 429 honor `Retry-After`; nếu thiếu thì dùng bounded exponential backoff + jitter.
- 503 chỉ retry khi có `Retry-After` theo policy hiện tại.
- Rate limit/user abort/capability rejection không bị tính như provider outage để mở circuit sai nghĩa.

## Reasoning control

Room hỗ trợ Auto hoặc mức reasoning cố định khi provider/model chấp nhận `reasoning_effort`. Chế độ manual được probe trước trên provider không thể xác minh trực tiếp; Auto dùng adaptive reasoning của runtime. Background summary/memory vẫn giữ policy chi phí thấp riêng.

## Inspector / token anatomy

Nút **Inspector** hiển thị diagnostics theo từng turn, gồm:

- end-to-end latency và first-token timing;
- provider call count/attempt timings;
- queue time, concurrency-at-acquire và retry wait/count;
- exact-vs-estimated usage;
- estimated token anatomy theo system/persona, history, summary, memory, private context, research, tool schema...;
- context budget before/after và phần bị drop;
- research/tool diagnostics.

Category breakdown là estimate. Khi provider trả exact input usage, exact total là nguồn authoritative và Inspector hiển thị delta so với anatomy estimate. Debug không dump private/system secret plaintext chỉ để phục vụ profiler.

## Scenario Engine / Ma Sói

Scenario Engine là backend state machine deterministic, không dùng một LLM thứ 7 làm trọng tài. MVP Ma Sói hỗ trợ 4-6 agent và gồm role assignment, night actions, doctor protection, seer inspect, day discussion/vote, tie handling và victory conditions.

Secret role/state chỉ nằm server-side. Public snapshot/history chỉ chứa phase, alive/dead, public events và winner. Scenario hiện ép chế độ theo lượt; session có secret state chưa hỗ trợ resume/fork để tránh serialize secret vào public/browser history.

## Fork / resume hội thoại thường

Hover message và bấm `fork` để tạo nhánh mới tại đúng message đó. Runtime cắt transcript và tạo **run id mới**. Nếu transcript đã dùng hết `maxTurns`, caller phải tăng cap rõ ràng trước khi tiếp tục; backend và UI cùng enforce contract này. Turn accounting áp dụng cho toàn bộ A-F.

## Preset

Preset Mặc định, Tranh biện, Brainstorm, Review code, Fact-check và Socratic vẫn được implement trong `lab-v2.js`, nhưng UI preset hiện đang ẩn. Không dựa vào preset như một control surface công khai cho tới khi product decision thay đổi.

## IndexedDB

Snapshot room được mirror vào IndexedDB (`ai-chat-lab-v2`) ngoài lịch sử localStorage hiện có. Local history UI giữ tập phiên nhẹ hơn, còn IndexedDB là lớp persistence/backup lớn hơn cho runtime v2.

## Kiểm tra

CI dùng Node 22 và chạy:

```bash
npm test
npm run check
```

`npm run check` dùng recursive checker cho JavaScript trong `src/`, `public/` và `scripts/`.
