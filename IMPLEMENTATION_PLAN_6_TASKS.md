# AI Conversation Lab — trạng thái roadmap 6 task

> Roadmap 6 task đã hoàn tất về mặt functional scope. Bản kế hoạch thi công chi tiết ban đầu được giữ nguyên tại [`docs/IMPLEMENTATION_PLAN_6_TASKS_ORIGINAL.md`](docs/IMPLEMENTATION_PLAN_6_TASKS_ORIGINAL.md) để tra cứu lịch sử thiết kế, acceptance criteria và dependency map.
>
> File này là trạng thái cuối sau audit. Current code vẫn là source of truth; luôn kiểm tra `main` HEAD và CI trước khi sửa tiếp.

## Audit checkpoint

- Repository: `giabao2605/AI-chat`
- Audit base trước PR docs cuối: `6934ba50e358ff42a2ccac808d9c674b5b308d4f`
- Audit date: 2026-09-16
- Active server room: `ScenarioRoom`
- Runtime hỗ trợ 2-6 agent A-F.
- Node.js `>=22.13.0`, ESM, không có runtime npm dependency ngoài Node core.
- CI ở audit base đã pass `npm test` + `npm run check` trên push `main`.

## Status / Decision log

| Task | Status | Kết quả / PR chính |
|---|---|---|
| Task 6 — Housekeeping + CI | **DONE** | PR #58: recursive JS checker, A-F correctness, docs six-agent, preset/fork/loop fixes. CI push trigger giữ nguyên có chủ đích vì PR vào `main` luôn chạy full CI. |
| Task 1 — Token Anatomy + Performance Profiler | **DONE** | PR #59: `request-metrics`, exact-vs-estimated usage, token anatomy, per-turn performance/Inspector diagnostics. |
| Task 2 — Context Budget per Agent | **DONE** | PR #60: deterministic global/per-agent budget, default 12000, safety/image reserve, observable before/after/pruning, no hidden sync model call. |
| Task 4 — Provider Scheduler / Rate-limit Manager | **DONE** | PR #61: process-wide endpoint+credential pools, concurrency queue, abort/timeout, 429/503 retry policy, shared cooldown, queue/retry profiler metrics. |
| Task 3 — Scenario / Game Engine | **DONE** | PR #62: generic deterministic Scenario Engine + Ma Sói/Werewolf MVP 4-6 AI; secret state backend-only; scenario resume/fork rejected intentionally. |
| Task 5 — Runtime architecture cleanup | **DONE, scoped stop** | PRs #63-#69: characterization tests, `TurnCoordinator`, `ContextAssembler`, `AgentExecutor`, active-path test migration, resume-cap contract fix, removal of legacy `orchestrator.js` + `resumable-room.js`, docs/test-name cleanup. |

## Task 5 final architecture decision

Task 5 đạt mục tiêu chính là tách responsibility/coupling khỏi một runtime path nguyên khối:

- `TurnCoordinator` sở hữu scheduling decisions.
- `ContextAssembler` sở hữu base message/context placement/budget semantics.
- `AgentExecutor` sở hữu provider streaming, diagnostics, cancellation, usage merge và image-tool loop.
- `ScenarioRoom` là top-level active room của server.
- Legacy `ConversationRoom` / `ResumableConversationRoom` đã được xóa sau khi coverage chuyển sang active path.

**Không flatten tiếp inheritance chain chỉ để giảm số mũi tên.** `ProfiledRoom`, `MemoryProfiledRoom`, `ReasoningMemoryProfiledRoom` và `ScenarioRoom` vẫn có responsibility riêng. Tiếp tục merge chúng ở checkpoint này làm blast radius tăng nhiều hơn complexity giảm. Đây là deliberate stop theo chính stop-rule của kế hoạch, không phải task bị quên.

Một acceptance wording cũ trong plan là “main room class nhỏ hơn rõ rệt / giảm inheritance depth”. Phần **composition/coupling** đã đạt; phần **literal inheritance-depth reduction** không được ép thực hiện vì không còn lợi ích đủ lớn để biện minh cho regression risk. Nếu sau này hierarchy trở thành pain point thực tế, mở một roadmap/refactor mới với characterization riêng thay vì nối dài Task 5 cũ.

## Final audit: những gì đã recheck

### CI / syntax safety

- `package.json` dùng `node scripts/check-js.mjs` thay vì hard-code file list.
- CI chạy Node 22, `npm test`, rồi `npm run check` cho PR vào `main`; push `main` cũng chạy full CI.
- Audit base `6934ba50...` có workflow `main` conclusion `success`.

### A-F correctness

- Loop detection derive từ configured `agentIds`, không còn regex A-D trên runtime path.
- History/fork turn counting nhận C-F.
- Optional E/F đi qua config/UI/private context/scheduling/Markdown surfaces.
- Những literal A-D còn trong preset persona definitions/UI compatibility không còn điều khiển runtime correctness; preset UI hiện vẫn intentionally hidden.

### Profiler / token accounting

- Exact provider usage được phân biệt với estimate.
- Category anatomy là estimate, không giả thành exact per-category usage.
- Multi-call turn vẫn aggregate usage; Inspector nêu rõ anatomy mô tả provider input được profile chứ không biến category estimate thành billing truth.
- Debug/profiler không cần dump private/system secret plaintext.

### Context budget

- `CONTEXT_INPUT_BUDGET_TOKENS` mặc định 12000; `0` thực sự disable pruning.
- Safety margin, image reserve và per-agent overrides tồn tại.
- System/topic/latest recent context được bảo vệ; optional context prune deterministic.
- Mandatory content vượt target được giữ và báo over-budget thay vì cắt mù.

### Provider scheduler / retry

- `PROVIDER_MAX_CONCURRENT_REQUESTS` mặc định 3; `0` thực sự chạy unlimited path.
- Pool key dùng normalized endpoint + SHA-256 credential fingerprint; raw key không được đưa vào visible key.
- Queued abort loại job ngay; queue timeout tách fetch timeout.
- 429 honor `Retry-After` hoặc bounded backoff; 503 chỉ retry theo policy có tín hiệu rõ.
- Rate-limit/user abort không bị coi như provider outage để mở circuit sai nghĩa.
- Conversation reply cooldown và provider rate scheduling vẫn là hai concern tách biệt.

### Scenario security

- Ma Sói dùng backend state machine, không dùng referee LLM.
- Role/seer/secret state không đi vào public transcript/SSE snapshot/long-term memory.
- Research planning chạy trước secret-context injection.
- Scenario session không resume/fork vì secret state không được persist public.

### Resume/history

- Hội thoại thường resume/fork tạo runtime `runId` mới.
- Nếu lịch sử đã dùng hết `maxTurns`, UI và active backend đều yêu cầu tăng cap rõ ràng (`RESUME_TURN_LIMIT_REACHED`). Bug contract này được phát hiện và sửa trong PR #67.
- Deleted-history/memory tombstone invariants vẫn có regression coverage.

## Một deviation không thể sửa ngược thời gian

Kế hoạch ban đầu yêu cầu **lưu live performance baseline trước Task 1/2/4**. Không có benchmark artifact/pre-change live measurements được commit trước khi các task đó merge.

Không nên bịa lại số “before” sau khi code đã thay đổi. Vì vậy audit ghi nhận đây là **process/documentation miss**, không phải runtime correctness bug. Current profiler đã cung cấp metric cần thiết để tạo baseline cho các tối ưu tương lai. Nếu cần benchmark thực tế với ProxyLLM/model đang dùng, chạy một benchmark riêng trên credential/environment thật và lưu kết quả từ checkpoint hiện tại trở đi.

## Definition of Done cuối

- [x] CI/check tự động bắt JS runtime/frontend/scripts.
- [x] Runtime A-F không còn correctness bug đã biết do assumptions A-D trên active path.
- [x] Inspector giải thích latency + token anatomy mỗi turn.
- [x] Long conversation có deterministic/observable context budget.
- [x] Shared provider credential có concurrency/rate-limit control + queue metrics.
- [x] Có generic Scenario Engine và Werewolf MVP không leak secret qua public/runtime channels.
- [x] Runtime concerns chính được tách theo composition, legacy duplicate runtime đã loại bỏ.
- [x] README/LAB/PROJECT_CONTEXT phản ánh architecture/capabilities hiện tại sau final docs audit.
- [x] `npm test` + `npm run check` pass tại audit base; final docs PR phải pass lại trước merge.

## PR sequence của roadmap

- #57 — add detailed original plan
- #58 — Task 6
- #59 — Task 1
- #60 — Task 2
- #61 — Task 4
- #62 — Task 3
- #63 — Task 5.0 characterization
- #64 — Task 5.1 TurnCoordinator
- #65 — Task 5.2 ContextAssembler
- #66 — Task 5.3 AgentExecutor
- #67 — Task 5.5a active-path test migration + resume-cap bug fix
- #68 — Task 5.5b remove legacy conversation runtimes
- #69 — Task 5.6 architecture docs/test-name cleanup

## Guidance sau roadmap

Roadmap này **đã đóng**. Nếu user yêu cầu feature/refactor mới, không tiếp tục đánh số subtask 1-6 cũ chỉ vì file lịch sử còn mô tả chúng.

Trước thay đổi mới:

1. lấy current `main` HEAD;
2. đọc `PROJECT_CONTEXT.md` và đúng subsystem liên quan;
3. giữ isolation invariants cho room, private context, memory và scenario secret;
4. thêm regression test cho behavior change;
5. chạy `npm test` + `npm run check`;
6. dùng branch + PR cho thay đổi đáng kể.
