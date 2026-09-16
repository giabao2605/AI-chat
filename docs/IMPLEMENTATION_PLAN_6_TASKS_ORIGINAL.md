# AI Conversation Lab — kế hoạch triển khai 6 task

> Mục tiêu của file này là làm **nguồn kế hoạch thi công dài hạn** cho 6 hạng mục cải tiến tiếp theo, để một AI/maintainer có thể mở repo ở một phiên khác, đọc file này, kiểm tra lại `main` hiện tại rồi tiếp tục đúng việc mà không phải tái dựng toàn bộ context từ đầu.
>
> Đây là **plan, không phải source of truth**. Trước mỗi task phải đọc lại `main` HEAD và các file liên quan vì repo thay đổi nhanh.

## 0. Snapshot và nguyên tắc thực thi

Snapshot dùng để lập plan này:

- Repository: `giabao2605/AI-chat`
- Branch gốc: `main`
- HEAD khi lập plan: `39f2ee8f799c380914665d64ceaa73e4f6b75a71`
- Runtime hiện tại hỗ trợ tối đa 6 agent A-F.
- Runtime room hiện có chuỗi kế thừa chính:
  - `MultiAgentRoom`
  - `ParallelBatchRoom`
  - `ProfiledRoom`
  - `MemoryProfiledRoom`
  - `ReasoningMemoryProfiledRoom`
- Provider là OpenAI-compatible streaming chat-completions.
- Không có runtime npm dependency ngoài Node core.
- Long-term memory dùng SQLite built-in của Node.
- Realtime UI dùng SSE.

### Luật làm việc để tránh loãng context

Mỗi lần bắt đầu một task hoặc subtask:

1. Đọc file này trước.
2. Lấy `main` HEAD mới nhất và so với snapshot phía trên.
3. Đọc lại đúng các file trong mục **Files cần xem trước khi code** của task đó.
4. Không tin line number cũ; chỉ tin behavior sau khi đọc code hiện tại.
5. Làm **một task/subphase tại một thời điểm**, không tiện tay kéo task khác vào cùng PR trừ khi là dependency bắt buộc.
6. Với thay đổi behavior, thêm regression test trước hoặc cùng commit.
7. Chạy `npm test` và `npm run check` trước khi coi task hoàn tất.
8. Với thay đổi lớn, dùng branch riêng và PR riêng.
9. Sau khi hoàn tất một task, cập nhật phần `Status / Decision log` cuối file này.
10. Nếu code hiện tại đã giải quyết một phần plan, bỏ phần thừa thay vì triển khai lại chỉ vì file này ghi thế.

### Các invariant không được phá

- Không rò API key, token credential hoặc secret nội bộ vào UI/debug/log.
- Private context chỉ được đưa cho đúng sender/recipient theo semantics hiện tại.
- Long-term memory của agent phải giữ isolation theo cấu hình scope hiện tại.
- Private context session-only không được tự động promote vào long-term memory.
- Multi-room không được cross-talk.
- Resume/history không được resurrect dữ liệu đã xóa.
- Estimated token phải luôn phân biệt rõ với provider-reported exact usage.
- Abort/stop phải dừng hoặc hủy cả request đang chạy lẫn request đang chờ queue.
- Scenario/game secret không được đi vào public transcript, public SSE state hoặc memory consolidation.
- Không thêm dependency mới nếu Node core giải quyết được rõ ràng.

---

# Thứ tự triển khai được khuyến nghị

Không nên làm theo số 1→6. Thứ tự an toàn hơn là:

1. **Task 6 — Housekeeping + CI safety net**
2. **Task 1 — Token Anatomy + Performance Profiler**
3. **Task 2 — Context Budget per Agent**
4. **Task 4 — Provider Scheduler / Rate-limit Manager**
5. **Task 3 — Scenario / Game Engine**
6. **Task 5 — Runtime architecture cleanup**

Lý do:

- Task 6 sửa lưới an toàn trước.
- Task 1 cho số liệu thật trước khi tối ưu.
- Task 2 dùng số liệu của Task 1 để cắt context có chủ đích.
- Task 4 bổ sung queue/rate metrics vào profiler đã có.
- Task 3 là feature lớn, nên xây trên runtime đã quan sát và kiểm soát tài nguyên tốt hơn.
- Task 5 là refactor sâu, nên làm cuối khi behavior đã được test và instrument đủ mạnh.

---

# TASK 6 — Housekeeping, six-agent correctness và CI auto-check

## Mục tiêu

Dọn các phần stale/hard-coded và biến CI syntax-check từ danh sách thủ công thành tự động, để các task sau có safety net đáng tin cậy.

## Vì sao phải làm trước

Hiện `package.json` hard-code từng file vào `npm run check`, trong khi repo đã có các file mới như `public/reasoning-control.js`, `public/private-context-inspector.js`, `public/memory-inspector.js`, `public/header-toolbar-layout.js`, `public/model-name-utils.js`... Không nên tiếp tục thêm feature trên một lưới CI có lỗ.

Ngoài ra vẫn còn dấu vết assumptions A-D trong code cũ dù HEAD đã hỗ trợ A-F.

## Files cần xem trước khi code

- `package.json`
- `.github/workflows/ci.yml`
- `README.md`
- `LAB_V2.md`
- `PROJECT_CONTEXT.md`
- `public/lab-v2.js`
- `public/six-agent-ui.js`
- `public/empty-state-ui.js`
- `public/index.html`
- `src/multi-agent-room.js`
- các test liên quan six-agent, fork/resume, preset, loop guard

## Subtask 6.1 — Thay syntax check hard-code bằng recursive checker

### Thiết kế

Tạo `scripts/check-js.mjs` dùng Node core:

1. Recursively scan:
   - `src/**/*.js`
   - `public/**/*.js`
   - `scripts/**/*.js` hoặc `.mjs`
2. Bỏ qua generated/static non-JS dirs nếu sau này có.
3. Chạy `process.execPath --check <file>` tuần tự hoặc concurrency nhỏ.
4. In file lỗi rõ ràng.
5. Exit non-zero nếu bất kỳ file nào fail.

Sau đó đổi:

```json
"check": "node scripts/check-js.mjs"
```

Không dùng shell glob để tránh khác biệt platform.

### Test

- Unit test helper thu thập file nếu tách được pure function.
- Hoặc ít nhất test rằng checker tìm thấy một số file mới hiện đang bị bỏ sót.
- CI vẫn chạy `npm test` rồi `npm run check`.

### Done khi

- Thêm file JS mới vào `src/` hoặc `public/` không cần sửa `package.json`.
- Syntax lỗi ở file mới làm CI fail.

## Subtask 6.2 — Audit assumptions A-D còn sót

Search ít nhất các pattern:

- `/^[a-d]$/`
- `['a', 'b', 'c', 'd']`
- `Agent C/D`
- loop/fork/turn counting dùng range cố định
- preset/persona loops cố định 4 agent

### Các điểm đã thấy ở snapshot

- `detectConversationLoop()` trong `src/multi-agent-room.js` đang lọc speaker bằng regex A-D, nên E/F có thể bị bỏ khỏi loop detection.
- `public/lab-v2.js` có logic cũ dùng A-D trong một số chỗ như preset và fork turn counting.
- Preset implementation cũ chủ yếu mô tả persona A-D; UI preset hiện có test cho trạng thái hidden, nên không được vô tình mở lại chỉ vì sửa six-agent.

### Cách sửa

Ưu tiên derive từ `agentIds`, `latestState.activeAgents` hoặc config thay vì regex/range literal.

Không đổi behavior khác nếu không cần.

### Regression tests

- Loop detection có message E/F.
- Fork/resume đếm turn E/F đúng.
- Six-agent UI vẫn render đúng.
- Preset hidden behavior không đổi trừ khi chủ động đổi product decision.

## Subtask 6.3 — Đồng bộ docs

Cập nhật ít nhất:

- `README.md`: 2-6 agents, E/F optional, shared provider credential nếu còn đúng.
- `LAB_V2.md`: không còn mô tả runtime 2-4 như hiện tại.
- `PROJECT_CONTEXT.md`: current generation 2-6, recent milestones, current HEAD tại thời điểm update.

Không biến `PROJECT_CONTEXT.md` thành changelog khổng lồ. Chỉ update architecture map và milestone cần thiết.

## Subtask 6.4 — Kiểm tra CI branch rules

Workflow hiện chạy push cho `main` và `feature/**`. Nếu conventions thực tế dùng `fix/**`, `refactor/**`, `docs/**`, thì push trực tiếp các branch đó không chạy CI, dù PR vào main vẫn chạy.

Quyết định sau khi xem workflow history:

- Giữ như hiện tại nếu PR CI là đủ.
- Hoặc đổi push trigger thành tất cả branch hoặc các prefix đang dùng thật.

Không bắt buộc đổi nếu không có nhu cầu.

## Acceptance criteria Task 6

- `npm run check` recursive, không còn list file thủ công.
- Không còn bug correctness rõ ràng do A-D hard-code trong runtime path hỗ trợ A-F.
- README/LAB/PROJECT_CONTEXT phản ánh 6 agents.
- `npm test` + `npm run check` pass.

## Không làm trong Task 6

- Không refactor class hierarchy.
- Không thêm profiler.
- Không thêm game engine.
- Không thay giao diện lớn.

---

# TASK 1 — Token Anatomy + Performance Profiler

## Mục tiêu

Trả lời được ba câu cho **mỗi turn**:

1. Tại sao lượt này chậm?
2. Input token đến từ đâu?
3. Số token đang hiển thị là exact hay estimate, và estimate lệch bao nhiêu nếu provider có usage thật?

Inspector phải chuyển từ raw debug JSON thành công cụ chẩn đoán đủ dùng.

## Hiện trạng quan trọng

- Provider đã có:
  - request attempt diagnostics
  - headers latency
  - first signal / first text / first tool timing
  - exact usage nếu provider trả usage
  - fallback estimate theo text khi provider không trả usage
- `runAgentTurn()` đã có:
  - end-to-end total time
  - first token time
  - summary debug
  - research debug
  - providerCalls diagnostics
- Memory và private context được inject ở wrapper layers sau khi base messages đã build.

Do đó profiler phải gom dữ liệu xuyên nhiều lớp, không chỉ đo trong `MultiAgentRoom`.

## Files cần xem trước khi code

- `src/provider.js`
- `src/multi-agent-room.js`
- `src/profiled-room.js`
- `src/memory-profiled-room.js`
- `src/reasoning-memory-room.js`
- `src/research.js`
- `src/deep-research.js`
- `public/lab-v2.js`
- `public/app.js`
- các provider/room tests hiện có

## Subtask 1.1 — Định nghĩa debug schema ổn định

Không để UI phụ thuộc vào structure ngẫu nhiên của từng layer.

Đề xuất message debug shape:

```js
{
  performance: {
    totalMs,
    preProviderMs,
    firstTokenMs,
    providerCalls,
    providerMs,
    queueMs,          // null cho tới Task 4
    retryWaitMs,      // null/0 cho tới Task 4
    researchMs,
    summaryMs,
    imageHydrationMs
  },
  context: {
    estimatedInputTokens,
    providerInputTokens,
    exactUsage,
    estimateDeltaTokens,
    budgetTokens,     // null cho tới Task 2
    breakdown: {
      systemAndPersona,
      topicInstruction,
      summary,
      recentHistory,
      memory,
      privateContext,
      researchEvidence,
      toolSchemas,
      imagesReserve,
      other
    }
  },
  provider: {...existing diagnostics...},
  research: {...},
  tools: {...}
}
```

Tên field có thể chỉnh khi code, nhưng phải có schema version hoặc tests đủ để UI không drift âm thầm.

## Subtask 1.2 — Tạo module metrics thuần

Tạo module kiểu:

- `src/request-metrics.js` hoặc `src/context-metrics.js`

Nó chỉ làm pure calculations:

- estimate tokens từ text/message/tool schema
- count chars
- merge context breakdown
- compare estimate vs exact usage
- không biết room lifecycle
- không biết UI

Có thể reuse estimator hiện tại của `provider.js`, nhưng tránh copy công thức ra nhiều nơi. Nếu cần, extract estimator sang utility nhỏ trong task này.

## Subtask 1.3 — Đo base context

Ngay khi build base agent messages, đo riêng:

- shared prompt
- participant list / identity notes
- persona/profile prompt
- topic instruction
- conversation summary
- loop guard
- recent transcript

Chỉ lưu **số liệu**, không lưu toàn bộ prompt plaintext vào debug nếu không cần.

Debug không được trở thành cách lộ private prompt/secret.

## Subtask 1.4 — Đo context inject ở wrapper layers

### Memory

Trong `MemoryProfiledRoom`:

- chars của memory block
- estimated tokens
- số memories retrieved
- IDs có thể giữ như hiện tại nếu không nhạy cảm, nhưng không cần dump nội dung memory vào profiler.

### Private context

Trong `ProfiledRoom`:

- count visible private entries
- chars / estimated tokens
- tuyệt đối không đưa content secret vào message debug.

### Web research

Đo:

- planner time
- search time
- deep-read time nếu tách được
- evidence chars / estimated tokens
- source count

### Tool schemas

Provider boundary đo size của tool definitions được gửi, vì tool schema có thể là một phần đáng kể của input overhead.

## Subtask 1.5 — So exact usage với estimate

Khi `usage.exact === true`:

- Hiển thị provider input token là nguồn authoritative.
- Breakdown theo category vẫn là estimate nếu không có tokenizer/provider-level category info.
- Tính delta giữa tổng category estimate và exact input usage.

Khi `usage.exact === false`:

- Gắn nhãn `estimated` rõ.
- Không giả vờ breakdown là chính xác tuyệt đối.

Nếu có nhiều provider calls trong một turn do tool/private context:

- aggregate usage như hiện tại
- profiler phải chỉ ra có bao nhiêu model round-trip
- context breakdown có thể lưu per-call summary hoặc ít nhất main-call + total

## Subtask 1.6 — Performance waterfall

Inspector render timeline dễ đọc:

```text
Turn total        3100 ms
├─ context prep    120 ms
├─ research          0 ms
├─ queue              -
└─ provider        2980 ms
   ├─ headers       840 ms
   ├─ first text   1120 ms
   └─ stream       1860 ms
```

Không cần chart library.

Ưu tiên DOM/CSS nhẹ hiện có.

## Subtask 1.7 — Token Anatomy UI

Trong message inspector:

```text
Input: 4,236 exact
Estimated anatomy:
- system + persona    ~1,050
- recent history      ~1,480
- long-term memory      ~420
- private context       ~310
- tool schemas          ~520
- topic/summary/etc      ~390
Estimate total        ~4,170
Delta vs provider        +66
```

Nếu exact unavailable:

```text
Input: ~4,170 estimated
```

## Tests

- Exact usage path.
- Estimated usage path.
- Memory on/off.
- Private context on/off.
- Tools on/off.
- Multiple provider calls aggregate đúng.
- Debug payload không chứa secret private context content.
- UI formatting không crash khi field mới absent trên history cũ.

## Acceptance criteria Task 1

Với một turn bất kỳ, Inspector cho biết:

- end-to-end latency
- provider TTFT/header timing
- exact/estimated token status
- token category breakdown
- số provider calls
- research/memory/private overhead theo số liệu

Không thay đổi conversation semantics.

## Không làm trong Task 1

- Không cắt context tự động.
- Không queue provider request.
- Không refactor inheritance sâu.

---

# TASK 2 — Context Budget per Agent

## Mục tiêu

Giới hạn input context có chủ đích, giảm latency/cost và tránh prompt phình khi chạy 4-6 agent, nhưng không làm mất dữ liệu quan trọng một cách ngẫu nhiên.

Task này phải dùng telemetry của Task 1 để kiểm chứng hiệu quả.

## Nguyên tắc

Không đơn giản làm `messages.slice(-N)`.

Context phải được chọn theo **priority + loại dữ liệu + recency + relevance**.

Không thêm model call mới chỉ để quyết định cắt context.

## Files cần xem trước khi code

- `src/multi-agent-room.js`
- `src/profiled-room.js`
- `src/memory-profiled-room.js`
- `src/agent-memory.js`
- `src/provider.js`
- `src/config.js`
- `.env.example`
- profiler module từ Task 1
- tests context/memory/private/research

## Subtask 2.1 — Config budget

Đề xuất config:

```env
CONTEXT_INPUT_BUDGET_TOKENS=12000
CONTEXT_BUDGET_SAFETY_MARGIN=0.12
CONTEXT_IMAGE_TOKEN_RESERVE=1500
# optional per-agent override
# AGENT_A_CONTEXT_BUDGET_TOKENS=16000
```

Con số cuối cùng phải benchmark trước khi merge. Nếu lo behavior change, có thể ship budget ở mode `0 = disabled` rồi bật bằng `.env.example`; nhưng product goal là nên có sensible default.

Per-agent override hữu ích khi model khác context window.

## Subtask 2.2 — Internal context segment model

Tạo pure module `src/context-budget.js`.

Một segment tối thiểu có:

```js
{
  kind,
  priority,
  mandatory,
  estimatedTokens,
  trimStrategy,
  payload,
  metadata
}
```

Không cần refactor toàn room thành ContextAssembler trong task này. Chỉ tạo representation vừa đủ để budget logic deterministic và testable.

## Subtask 2.3 — Priority policy

### P0 — Mandatory

Không drop trừ khi request vốn đã vượt budget chỉ vì mandatory content:

- system/shared prompt
- identity/persona
- topic/current task instruction
- latest triggering user/private/scenario event cần cho turn hiện tại
- minimal tool schema cần thiết cho lượt

Nếu P0 tự vượt budget:

- không silently truncate system prompt giữa câu
- emit debug warning `contextBudgetExceededByMandatory`
- tiếp tục request hoặc fail có thông báo tùy model/provider policy; không cắt mù.

### P1 — Active-task evidence

- web evidence nếu lượt này đã quyết định research
- private context mới/chưa thấy liên quan trực tiếp
- recent conversation mới nhất
- scenario state hiện tại sau Task 3

### P2 — Supporting context

- long-term memories retrieved theo relevance
- compressed conversation summary
- private context cũ hơn

### P3 — Old/redundant context

- older recent transcript
- low-ranked memory
- verbose source text có thể prune

## Subtask 2.4 — Trim strategy theo loại

### Recent history

- drop oldest first
- luôn giữ một cửa sổ tối thiểu của các message gần nhất
- trong parallel mode, ưu tiên unseen trigger events của agent

### Memory

- giảm số memory items theo relevance/importance trước
- sau đó mới truncate text item nếu cần

### Private context

- giữ newest/relevant first
- ưu tiên message agent vừa nhận chưa phản ứng
- không đổi isolation semantics

### Summary

- summary vốn đã bounded
- không gọi model sync thêm để re-summarize
- nếu phải trim, dùng deterministic head/tail strategy hoặc giới hạn char riêng có test

### Web evidence

- prune source thấp rank trước
- giảm chars/source trước khi bỏ toàn bộ top source
- giữ source labels/citation mapping nhất quán

### Images

Image token cost phụ thuộc provider/model, nên profiler/budget chỉ dùng conservative reserve. Không tuyên bố đó là exact token count.

## Subtask 2.5 — Final preflight

Ngay trước provider request:

1. tính estimated total
2. apply safety margin
3. nếu > budget, prune theo policy
4. tính lại
5. ghi `debug.context.budget`:
   - requested budget
   - before tokens
   - after tokens
   - dropped/truncated segment counts
   - reasons

Không log dropped secret content.

## Subtask 2.6 — Interaction với summary

Current profiled room đã dùng provisional summary và background refresh.

Budget manager không được tạo vòng lặp kiểu:

- vượt budget → summary model call
- summary model call chậm → lại trigger budget khác

Summary refresh giữ asynchronous behavior. Budget là deterministic final selection.

## Tests

Matrix tối thiểu:

- 2 agent / 6 agent
- turns / parallel
- long transcript
- memory enabled
- private context nhiều
- research evidence lớn
- image attachment
- budget disabled
- budget cực nhỏ
- mandatory content > budget

Assertions:

- latest trigger không bị drop
- secret isolation không đổi
- selected context <= target estimate khi có thể
- behavior deterministic với cùng input

## Benchmark trước/sau

Dùng một fixture conversation cố định 30-50 messages:

- input tokens / turn
- TTFT
- total latency
- answer quality smoke check

Không merge chỉ vì token giảm nếu model mất context quan trọng thấy rõ.

## Acceptance criteria Task 2

- Có configurable context budget.
- Inspector cho thấy before/after và phần nào bị prune.
- Long room không tiếp tục tăng input vô kiểm soát.
- Không thêm hidden synchronous LLM call.

---

# TASK 4 — Provider Scheduler / Rate-limit Manager

## Mục tiêu

Khi nhiều agent/room dùng cùng gateway hoặc API key:

- tránh burst 6 request cùng lúc một cách mù quáng
- đo queue time
- honor server rate-limit signals
- retry có kiểm soát cho lỗi rõ ràng retryable
- không biến retry thành double-charge roulette

## Reference đã kiểm tra khi lập plan

- HTTP `Retry-After` có thể là số giây hoặc HTTP-date theo RFC 9110.
- OpenAI hiện khuyến nghị honor `Retry-After`; nếu thiếu/invalid thì exponential backoff + jitter, giới hạn số retry và tổng thời gian retry.

References:

- https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after
- https://help.openai.com/en/articles/5955604-how-can-i-solve-429-too-many-requests-errors

Vì app dùng generic OpenAI-compatible provider, không assume mọi gateway có cùng rate-limit headers ngoài chuẩn HTTP phổ biến.

## Files cần xem trước khi code

- `src/provider.js`
- `src/config.js`
- `src/server.js`
- `src/room-manager.js`
- `src/multi-agent-room.js`
- `src/parallel-batch-room.js`
- `src/orchestrator.js` nếu còn runtime path liên quan
- provider tests / parallel tests
- profiler từ Task 1

## Subtask 4.1 — Process-wide scheduler

Tạo `src/provider-scheduler.js`.

Scheduler instance nên ở server/process scope, không phải mỗi room, vì cùng credential có thể bị rate limit xuyên room.

### Pool key

Group theo:

- normalized endpoint/base URL
- credential identity

Không đưa raw API key vào debug/string visible.

Có thể fingerprint API key bằng SHA-256 và chỉ giữ short fingerprint in-memory/debug nếu thật sự cần.

## Subtask 4.2 — Concurrency queue

API gợi ý:

```js
await scheduler.run(poolKey, async () => providerRequest(), {
  signal,
  queueTimeoutMs,
  metadata
});
```

Requirements:

- FIFO ban đầu là đủ.
- Abort signal khi đang queue phải remove job ngay.
- Stop room không được để queued job sau đó tự chạy.
- Queue timeout tách khỏi provider fetch timeout để debug rõ.
- Không starvation giữa room; nếu sau benchmark thấy một room chiếm queue thì bổ sung round-robin fairness ở phase sau.

## Subtask 4.3 — Config

Đề xuất ban đầu:

```env
PROVIDER_MAX_CONCURRENT_REQUESTS=3
PROVIDER_QUEUE_TIMEOUT_MS=60000
PROVIDER_RATE_LIMIT_MAX_RETRIES=2
PROVIDER_RETRY_BASE_MS=500
PROVIDER_RETRY_MAX_MS=8000
```

Giá trị default phải benchmark với ProxyLLM hiện dùng trước khi merge.

Nếu muốn backward compatibility tuyệt đối, `0 = unlimited` có thể là default code và `.env.example` khuyến nghị 3. Quyết định bằng benchmark, không đoán.

## Subtask 4.4 — Retry policy

### Retry rõ ràng

MVP chỉ retry khi có HTTP response rõ:

- 429
- 503 khi có `Retry-After`, hoặc policy xác định service-unavailable temporary

Không blind retry network timeout/connection reset sau khi request đã có khả năng được provider xử lý, vì có nguy cơ request kép/billing kép.

### Delay

1. Nếu `Retry-After` hợp lệ → chờ ít nhất thời gian đó.
2. Nếu không → exponential backoff + jitter.
3. Có max retry count.
4. Có max total retry delay.

### Shared cooldown

Khi một request pool nhận 429 + Retry-After, scheduler nên có cooldown cho cả pool để agent khác không lập tức lao vào cùng key.

## Subtask 4.5 — Circuit breaker interaction

Provider hiện tăng failure count trên error nói chung.

Cần phân loại:

- rate limited ≠ provider chết
- abort do user ≠ failure
- capability fallback 400/404/415/422 ≠ service outage
- 5xx/network hard failures mới phù hợp hơn với circuit breaker

Không để vài 429 làm circuit mở sai nghĩa.

## Subtask 4.6 — Merge cooldown constants

Snapshot hiện có `PARALLEL_REPLY_COOLDOWN_MS` khác nhau giữa một số legacy/runtime files.

Không nhất thiết xóa hết ngay, nhưng phải:

- xác định path nào thật sự active
- đưa provider rate queue ra khỏi conversation reply cooldown
- không dùng reply cooldown như rate-limit workaround

Conversation scheduling và provider scheduling là hai lớp khác nhau.

## Subtask 4.7 — Profiler integration

Bổ sung:

- `queueMs`
- pool concurrency tại lúc acquire
- rate-limit retry count
- retry wait total
- Retry-After source nếu có

Không lộ pool key nếu key đó encode credential material.

## Tests

- max concurrency không vượt config
- FIFO
- aborted queued job không chạy
- queue timeout
- 429 + Retry-After seconds
- 429 + Retry-After date
- missing Retry-After → exponential + jitter trong bound
- max retry
- 503 policy
- rate limit không mở circuit như hard failure
- separate credentials không block nhau
- same credential across rooms dùng chung pool

Dùng fake timers / fake fetch, không test bằng live gateway.

## Acceptance criteria Task 4

- 6 agent chung key không burst vô hạn.
- Queue visible trong Inspector.
- 429 được xử lý có kiểm soát.
- Stop/abort vẫn tức thời với queued requests.

---

# TASK 3 — Scenario / Game Engine

## Mục tiêu

Biến project từ “nhiều AI chat chung phòng” thành runtime có thể chạy **scenario có luật, phase, role, secret state và legal action**.

MVP đầu tiên: Ma Sói/Werewolf dạng deterministic backend referee.

## Product decision quan trọng

Không implement Ma Sói bằng một cục prompt lớn.

Luật game phải nằm ở backend state machine. AI chỉ quyết định lời nói/hành động trong phạm vi luật backend cho phép.

Không dùng một AI thứ 7 làm trọng tài nếu backend có thể quyết định deterministic.

## Security / isolation decision

Game secret phải là **scenario secret state riêng trên server**.

Không nhét role/secret vào:

- public transcript
- public `snapshot()`
- SSE state gửi mặc định
- long-term memory
- generic debug event payload

Không reuse agent-generated private-context store như canonical game-state database. Hai concept có thể dùng cùng kỹ thuật injection, nhưng ownership/lifecycle khác nhau.

## Files cần xem trước khi code

- `src/multi-agent-room.js`
- `src/profiled-room.js`
- `src/memory-profiled-room.js`
- `src/agent-tools.js`
- `src/resumable-room.js`
- `src/server.js`
- `public/room-session.js`
- `public/lab-v2.js`
- history/resume/fork code
- private-context tests

## Subtask 3.1 — Generic scenario contract

Tạo layer kiểu:

```text
ScenarioDefinition
ScenarioState
ScenarioController
```

Interface cần hỗ trợ:

- id / version
- minimum/maximum players
- initialize(agentIds, options, rng)
- publicState()
- privateContextFor(agentId)
- legalActionsFor(agentId)
- eligibleSpeakers()
- applyAction(agentId, action)
- onPublicMessage(...)
- maybeAdvancePhase()
- isComplete()
- result()

Deterministic RNG seed nên injectable trong tests.

## Subtask 3.2 — Scenario integration với room

Không rewrite room loop ngay.

Thêm composition hook tối thiểu:

- room có optional `scenarioController`
- trước turn: hỏi scenario agent có eligible không
- context build: inject public phase + private scenario context đúng agent
- tools: inject legal scenario actions
- sau action/message: scenario được notify và có thể advance phase

Task 5 sau này mới extract sạch `TurnCoordinator`.

## Subtask 3.3 — Scenario context injection

Mỗi agent nhận hai block khác nhau:

```text
<scenario_public_state>...</scenario_public_state>
<scenario_private_state>...</scenario_private_state>
```

Private block chỉ chứa secret của agent đó.

Debug chỉ ghi:

- phase
- action type
- state version
- chars/tokens secret block

Không ghi secret content.

Memory consolidation hiện dựa trên public history, nên phải giữ scenario secret khỏi history để nó không lọt vào SQLite.

## Subtask 3.4 — Generic scenario action tool

Tạo tool riêng, ví dụ `scenario_action`.

Schema dynamic theo phase/role:

- chỉ expose action hợp lệ
- recipient/target enum chỉ gồm target hợp lệ
- backend validate lại toàn bộ, không tin model output

Ví dụ actions:

- `vote`
- `wolf_kill`
- `seer_inspect`
- `doctor_protect`
- `pass`

Tool result trả thông tin tối thiểu cần thiết.

## Subtask 3.5 — Werewolf MVP state machine

### Phase gợi ý

1. `setup`
2. `night`
3. `night_resolution`
4. `day_discussion`
5. `day_vote`
6. `day_resolution`
7. lặp
8. `completed`

### Role MVP

- Werewolf
- Seer
- Doctor
- Villager

Default role composition có thể scale theo số agent, nhưng phải config/test explicit; không chôn logic balance khó thấy.

Ví dụ 6 agent có thể dùng 2 wolves + 1 seer + 1 doctor + 2 villagers, nhưng đây là product tuning, không phải invariant kỹ thuật.

### Night

- Sói chọn target.
- Seer inspect target.
- Doctor protect target.
- Backend resolve deterministic sau khi đủ action hoặc policy timeout/pass.
- Chỉ agent có quyền mới thấy action tương ứng.

### Day

- Backend announce public outcome tối thiểu.
- Discussion chạy qua normal chat scheduler với phase context.
- Sau discussion quota/condition → vote phase.
- Mỗi alive agent vote một lần.
- Backend resolve elimination/tie.

### Victory

Backend kiểm tra sau resolution:

- wolves == 0 → village win
- wolves >= non-wolves → wolves win

## Subtask 3.6 — Speaker gating

Current free-running mode cho agent react khi có unseen input.

Scenario phải thêm gating:

- dead agents không nói/action
- night chỉ role eligible hành động
- day discussion chỉ alive agents
- vote chỉ agent chưa vote

Không hack bằng prompt “bạn đã chết nên đừng nói”. Backend phải chặn.

## Subtask 3.7 — UI

MVP UI cần:

- scenario selector hoặc command rõ ràng
- phase badge
- alive/dead public status
- round/day number
- public event log
- start/reset scenario

Không cần animation cầu kỳ.

Role/secret của từng AI không hiển thị public mặc định.

Nếu user là host và muốn inspect secrets, làm explicit host/debug drawer sau, không nhét vào normal state.

## Subtask 3.8 — Resume/fork decision

Đây là chỗ dễ làm sai nhất.

MVP được phép **tạm thời không hỗ trợ fork/resume scenario** nếu chưa có secret-state snapshot an toàn.

Nếu hỗ trợ:

- secret scenario snapshot phải có version
- không đi vào public browser history dưới dạng raw roles nếu product không muốn user/client thấy
- restore phải validate agent list + phase + action state

Khuyến nghị phase đầu:

- disable fork/resume cho scenario session
- ghi rõ UI reason
- bổ sung persisted scenario snapshot ở phase sau

Tốt hơn làm đúng sau còn hơn resume nửa mùa làm lộ cả bầy sói.

## Tests

### Unit state machine

- role assignment deterministic với seeded RNG
- legal actions từng role/phase
- invalid action rejected
- kill/protect interaction
- seer result private
- vote/tie
- win conditions

### Isolation

Assert secret role/action không xuất hiện trong:

- public history
- room public snapshot
- generic debug events
- memory consolidation input
- unrelated agent model payload

### Runtime

- 4/5/6 agents
- turns/parallel nếu scenario cho phép
- stop/reset giữa phase
- agent provider error không corrupt game state

## Acceptance criteria Task 3

Một game Werewolf MVP 4-6 AI chạy từ setup đến victory bằng backend state machine, không cần trọng tài LLM và không leak secret qua public/runtime channels.

---

# TASK 5 — Runtime architecture cleanup

## Mục tiêu

Giảm coupling và inheritance depth mà **không đổi behavior**.

Task này làm cuối vì khi đó profiler, budget, scheduler và scenario đã tạo đủ tests/observability để refactor an toàn.

## Hiện trạng cần tôn trọng

Inheritance hiện đang gánh nhiều concern:

- lifecycle
- turn scheduling
- parallel scheduling
- context build
- provider execution
- private context tools
- memory retrieval/consolidation
- reasoning override

Không được rewrite toàn bộ trong một PR.

## Files cần xem trước khi code

Gần như toàn runtime:

- `src/multi-agent-room.js`
- `src/parallel-batch-room.js`
- `src/profiled-room.js`
- `src/memory-profiled-room.js`
- `src/reasoning-memory-room.js`
- `src/orchestrator.js`
- `src/provider.js`
- modules mới từ Tasks 1/2/3/4
- toàn test room/runtime

## Phase 5.0 — Characterization tests

Trước extraction, thêm tests khóa behavior nếu coverage còn thiếu:

- turns order
- parallel triggers
- pause/resume/stop
- max turn limit
- private trigger wake-up
- memory retrieval/consolidation timing
- reasoning override
- research/tool calls
- scenario gating

Refactor PR không nên đồng thời đổi expected product behavior.

## Phase 5.1 — Extract TurnCoordinator

Tên nên tránh nhầm với Provider Scheduler.

Responsibilities:

- chọn speaker tiếp theo
- parallel eligibility
- unseen trigger tracking
- scenario eligible speaker hook
- turn-limit accounting
- pause/resume scheduling wakeups

Room vẫn sở hữu state; coordinator chỉ quyết định scheduling.

Sau extraction, remove duplicated `PARALLEL_REPLY_COOLDOWN_MS` path nếu đã xác định obsolete.

## Phase 5.2 — Extract ContextAssembler

Sau Task 2, context segment/budget logic đã khá rõ.

ContextAssembler nhận:

- room public history
- summary
- profile/persona
- memory candidates/block
- private context
- research evidence
- scenario context
- tool capability notes

Output:

- provider messages
- metrics/breakdown
- budget decisions

Không tự gọi provider.

## Phase 5.3 — Extract AgentExecutor

Responsibilities:

- một agent turn execution
- provider streaming
- tool-call loop
- merge usage
- first-token events
- provider diagnostics
- cancellation

Room/coordinator không nên chứa chi tiết SSE token stream/provider retry.

## Phase 5.4 — Normalize tool pipeline

Sau khi AgentExecutor tồn tại, image/private/scenario tools có thể đi qua một tool registry/pipeline thống nhất nếu thực sự giảm code.

Không ép abstraction nếu các tool semantics quá khác nhau.

## Phase 5.5 — Flatten inheritance dần

Không xóa class cũ ngay.

Strategy:

1. Class hiện tại delegate sang components mới.
2. Tests pass.
3. Chuyển responsibility từng phần.
4. Khi subclass chỉ còn wrapper mỏng, merge/remove sau.

`parallel-batch-room.js` có thể giữ compatibility alias một thời gian trước khi rename/remove.

## Phase 5.6 — Dead-code audit

Sau migration:

- check `orchestrator.js` có còn active path không
- check duplicated scheduling/constants/helpers
- remove legacy only khi code search + tests xác nhận không dùng

Không xóa vì “tên trông cũ”.

## PR strategy

Task 5 phải chia nhiều PR:

1. characterization tests only
2. TurnCoordinator extraction
3. ContextAssembler extraction
4. AgentExecutor extraction
5. optional tool pipeline
6. inheritance cleanup/dead-code removal

Mỗi PR phải runnable độc lập.

## Acceptance criteria Task 5

- Main room class nhỏ hơn rõ rệt.
- Scheduling/context/provider concerns có module riêng.
- Không giảm test coverage.
- No user-visible behavior regression.
- Node-core architecture vẫn giữ nếu chưa có lý do mạnh để thêm dependency.

---

# Cross-task dependency map

```text
Task 6  ──> Task 1 ──> Task 2 ──────┐
               │                    │
               └────> Task 4 ───────┤
                                    ├──> Task 3
                                    │
                                    └──> Task 5
```

Task 3 không strictly cần Task 4, nhưng làm sau Task 4 sẽ tránh game 6-agent tạo burst/rate-limit khó debug.

Task 5 phụ thuộc mạnh vào tests/telemetry của mọi task trước.

---

# Regression matrix chung

Mỗi task lớn nên chạy/cover các chiều sau khi có liên quan:

| Dimension | Cases |
|---|---|
| Agent count | 2, 4, 6 |
| Conversation mode | turns, parallel |
| Memory | off, on |
| Private context | none, active |
| Web | off, search, deep research |
| Usage | exact, estimated |
| Tool support | supported, rejected/fallback |
| Vision | no image, accepted, fallback |
| Provider credentials | shared key, separate keys |
| Room | single-room, multi-room |
| Lifecycle | start, pause, resume, stop, reset, continue |
| Scenario | none, active after Task 3 |

Không cần mọi test là full Cartesian product. Chọn representative integration cases + pure unit tests cho module mới.

---

# Performance baseline cần lưu trước Task 1/2/4

Tạo một fixture/manual benchmark document hoặc script nhẹ với ít nhất:

1. 2 agents, 5 turns, không memory/research.
2. 6 agents parallel, shared provider key.
3. 6 agents sau transcript dài ~30-50 messages.
4. memory retrieval active.
5. private context active.
6. web research active.

Record:

- average input tokens
- exact vs estimated ratio
- TTFT
- total latency
- provider call count
- 429/error count nếu có

Không dùng một live benchmark duy nhất làm unit test vì flaky.

---

# Các quyết định đã double-check khi lập plan

## 1. Housekeeping phải đi trước profiler

Vì syntax check hiện hard-code và code còn dấu vết A-D. Safety net trước, feature sau.

## 2. Profiler phải đi trước Context Budget

Nếu cắt context trước khi biết token đến từ đâu, rất dễ tối ưu sai chỗ.

## 3. Category token breakdown chỉ là estimate

Provider có thể trả exact total input usage nhưng không trả per-category usage. UI phải nói rõ điều này.

## 4. Scheduler phải process-wide theo provider credential

Rate limit không có khái niệm room. Hai room cùng API key vẫn chia cùng quota.

## 5. Không retry mù network errors

Nếu request đã đến provider nhưng response connection chết, retry có thể tạo request kép. MVP retry chỉ khi server response rõ ràng cho phép/khuyến nghị retry.

## 6. Game secret là server-side scenario state

Không lấy generic private-context log làm canonical role database. Cùng là secret nhưng lifecycle, quyền sở hữu và restore semantics khác nhau.

## 7. Scenario MVP có thể chưa resume/fork

Đây là deliberate scope control để tránh raw secret snapshot rơi vào browser history/public state.

## 8. Refactor architecture làm cuối

Không rewrite inheritance trước khi behavior có telemetry và characterization tests.

---

# Definition of Done toàn roadmap

Roadmap được coi là hoàn tất khi:

- CI/check tự động bắt toàn JS runtime/frontend.
- Runtime A-F không còn correctness bug do assumptions A-D.
- Inspector giải thích được latency + token anatomy mỗi turn.
- Long conversation có context budget deterministic và observable.
- Shared provider credential có concurrency/rate-limit control + queue metrics.
- Có Scenario Engine generic và Werewolf MVP không leak secret.
- Runtime core đã được tách responsibility theo composition mà không regression.
- `README.md`, `LAB_V2.md`, `PROJECT_CONTEXT.md` được cập nhật theo final architecture.
- `npm test` và `npm run check` pass tại HEAD cuối.

---

# Status / Decision log

Cập nhật mục này sau mỗi PR để phiên AI sau không phải đoán.

| Task | Status | Last decision / PR |
|---|---|---|
| Task 6 — Housekeeping + CI | PLANNED | Plan created from main `39f2ee8` |
| Task 1 — Profiler | PLANNED | Implement after Task 6 |
| Task 2 — Context Budget | PLANNED | Depends on profiler metrics |
| Task 4 — Provider Scheduler | PLANNED | Process-wide pool; controlled 429/503 retry |
| Task 3 — Scenario/Game Engine | PLANNED | Server-side secret state; Werewolf MVP |
| Task 5 — Architecture cleanup | PLANNED | Do last, split into multiple PRs |

### Template khi update

```text
YYYY-MM-DD — Task X / PR #NN
- Done:
- Behavior changed:
- New files/modules:
- Important config:
- Known follow-up:
- Tests added:
- Deferred intentionally:
```

---

# Hướng dẫn cho AI/maintainer ở phiên sau

Nếu user nói kiểu “làm tiếp roadmap”, đừng đọc toàn repo rồi sáng tạo roadmap mới.

1. Đọc bảng Status ở trên.
2. Lấy current main HEAD.
3. Xem PR/commit sau entry cuối.
4. Chọn đúng task tiếp theo theo dependency.
5. Re-read files của task đó.
6. Thực hiện subtask nhỏ nhất tạo được progress hoàn chỉnh.
7. Test.
8. Update file này.

Nếu current code mâu thuẫn file plan, current code thắng. Update plan để phản ánh thực tế thay vì ép code quay lại snapshot cũ.
