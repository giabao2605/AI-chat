# AI Conversation Lab — Stability & Hardening Plan

**Version:** 1.0  
**Created:** 2026-10-31  
**Repository:** giabao2605/AI-chat  
**Reviewed baseline:** main @ 4783728a37de8d83ea1f04eb2a3a9177bdb2dfd2  
**Status:** PROPOSED / NOT IMPLEMENTED  
**Change type:** Bug fixes, hardening, performance and regression testing only

> This is a work plan, not a claim that every suspected failure has been reproduced. Observations are based on static code review. Verify each hypothesis with a failing test or an observable benchmark before changing production behavior.

## 1. Objective, boundaries and success criteria

### Objective
Make existing 2–6-agent chat, sequential/parallel execution, web research, long-term memory, private contexts, scenario mode, image generation, history/resume/fork and diagnostics more reliable, safer and less resource-intensive **without adding any user-facing feature**.

### Non-goals
- Do not introduce new modes, buttons, endpoints for new features, providers, dependencies, UI redesigns or product scope.
- Do not change existing prompts/personas, response style, agent scheduling semantics, memory recall thresholds or research decisions merely for cosmetic reasons.
- Do not change default environment variables, storage schema or public response/event shapes unless technically necessary and compatibility has been demonstrated.
- Do not silently remove old history, overwrite an existing SQLite database, disable existing tools or change session privacy semantics.
- Do not deploy, rotate credentials, expose the server to the Internet or alter infrastructure as part of this plan without a separate explicit decision.

### Completion gates (all mandatory)
1. Every reproduced defect has a regression test that fails before and passes after its fix.
2. Existing test suite: `npm test` and `npm run check` pass on Node.js 22.13+.
3. UI/behavior smoke tests pass for 2 and 6 agents in sequential and parallel modes; pause/resume/stop/reset; memory; web search; image; history/resume/fork; and Werewolf where configured.
4. No additional user-facing feature, incompatible API/SSE payload change or unintended change in AI behavior.
5. Performance claims are supported by before/after measurements with identical inputs and environment.
6. Security fixes include negative tests, and no private data/API keys are exposed through errors, logs or API responses.

## 2. Priority and delivery sequence

| ID | Priority | Area | Key risk / outcome | Primary files |
| --- | --- | --- | --- | --- |
| SH-01 | P1 | Session lifecycle | Stale async work overwrites a stopped/reset/new run | `src/multi-agent-room.js`, `src/server.js` |
| SH-02 | P1 | History + SSE efficiency | Redundant large snapshot serialization and uncontrolled slow-client writes | `public/app.js`, `public/history.js`, `public/lab-v2.js`, `src/room-manager.js`, `src/server.js` |
| SH-03 | P1 | Deep research hardening | Partial IP/URL validation and unbounded response buffering | `src/deep-research.js` |
| SH-04 | P0 if public; P1 otherwise | Local API security | API/memory controls reachable without auth if directly exposed | `src/server.js`, `src/config.js`, deployment docs |
| SH-05 | P2 | Provider compatibility cache | Different credentials influence one another's capability state | `src/provider.js`, `src/provider-scheduler.js` |
| SH-06 | P2 | Error taxonomy + testing | Operational failures misreported as HTTP 400, missing edge-case coverage | `src/server.js`, `test/`, CI |
| SH-07 | P2 | DOM rendering safety | Some configured strings interpolate into `innerHTML` | `public/lab-v2.js`, related UI modules |

**Priority note:** SH-04 becomes a release blocker (P0) only for Internet-exposed deployments. Current example configuration binds to `127.0.0.1`; do not assume the repo is already publicly deployed.

**Suggested implementation order:** Baseline/G0 → SH-04 exposure audit and SH-01 → SH-03 → SH-02 → SH-05 → SH-06/SH-07 → integrated validation/G4. SH-04 local-only safeguards can be implemented in the first hardening batch.

## 3. G0 — Record baseline and reproduce

### Actions
1. Work from a fresh feature branch per coherent fix; do not implement this entire plan in a single unreviewed commit. Keep main unchanged until tests and review pass.
2. Record Node version, OS, baseline commit and `npm test` / `npm run check` output.
3. Capture current payload/event schema for `/api/state`, `/api/events`, `/api/health`, `/api/config` and relevant memory endpoints. Compare later.
4. Capture CPU, memory, browser main-thread time, localStorage/IndexedDB write count and SSE payload byte count for identical 2-agent and 6-agent conversations (e.g. 50/100/200 turns, same mocked provider output).
5. Use deterministic mock providers and fake timers/signals where possible. Avoid real API costs and flaky timing tests.
6. Record each issue as **confirmed**, **not reproduced** or **design risk**. Reprioritize based on evidence.

### Deliverables
- Baseline measurement table in PR description (or a short doc next to test reports).
- Minimal failing test for each confirmed functional bug.
- Explicit statement of what is not yet proven.

## 4. SH-01 — Session lifecycle and stale async results (P1)

### Static-review evidence
- `src/multi-agent-room.js`: `start()` enters `starting`, may await `chooseTopic()` and then unconditionally sets `topic` / `status = running` and schedules execution.
- `chooseTopic()` updates usage after awaiting the provider.
- `stop()` and `reset()` can run while an earlier provider request or other asynchronous operation is still settling.
- `src/server.js`: `/api/tools/image` awaits generation, then `recordImageMessage()` uses the room's current state, which may have changed during the await.

### Failure scenarios to reproduce
A. Call Start with `topicMode=auto` and an intentionally delayed provider; Stop before provider settles. Provider resolves or rejects late. Assert the session stays stopped and no new messages/turns start.  
B. Same as A but Reset, then Start a new run. Assert the old request does not mutate the new run's topic, status, usage, history or debug events.  
C. Call Reset during image generation; finish the image response. Assert the resulting attachment is not inserted into an unrelated run.  
D. Rapid Start → Stop → Start; Pause → Stop; and parallel multi-agent cancellation. Assert no orphan scheduled work or duplicated completed messages.

### Implementation steps
1. Define an explicit run-generation/identity invariant. Capture current `runId` (or a monotonic generation) before starting any asynchronous stage and after every `await` verify identity and non-terminal status **before modifying state**.
2. Pass the captured run identity / cancellation signal into auto-topic and other startup tasks. Ensure `chooseTopic()` does not call `addUsage()` for a stale run.
3. Distinguish intended cancellation from operational failure: Stop/Reset must not become `error` if an old provider promise rejects later.
4. Set the state transition to `running` and launch loops only if the same run remains in `starting`. Ensure each transition is emitted once and no stale `topic` event is broadcast.
5. For direct image generation, capture the intended room/run identity before awaiting `imageTool.generate()`. Validate before committing the result. For a replaced run, return a clear cancellation/conflict result rather than writing into the new transcript; decide whether to discard/delete any orphaned generated file safely.
6. Review `continueFromHistory()`, private-context and memory background jobs for the same generation fence. Do not let old work update SQLite, context summary or current-room stats after a reset unless explicitly designed and tested.
7. Prefer a small helper for "is this run still current?" rather than scattered contradictory conditions.

### Tests and acceptance
- Add `test/session-start-cancellation.test.js` and `test/image-generation-run-race.test.js` or extend existing runtime/image tests.
- Use deferred provider promises and controlled AbortSignal behavior, including a provider that **ignores abort** and resolves late.
- Pass: no stale state writes, no duplicate turns, no orphan running loop, no accidental attachment to new session; existing normal startup and restart behavior unchanged.

## 5. SH-02 — History storage, UI serialization and SSE backpressure (P1)

### Static-review evidence
- `public/app.js`: `applyState()` calls `saveCurrentSnapshot()`, which builds/sorts cloned history and compares large `JSON.stringify` payloads.
- `public/history.js`: `createHistoryRecord()` deep-clones transcript and stats with JSON serialization.
- `public/lab-v2.js`: `setInterval(...persistIndexedDb, 2500)` can rewrite the current session snapshot on unchanged state.
- `src/server.js`: `sendSse()` writes without inspecting the `res.write()` return value.
- `src/room-manager.js`: `broadcast()` attempts to write to each connected SSE client without an explicit slow-client policy.

### Implementation steps
1. **Measure first.** Instrument (test-only or opt-in debug) snapshot serialization time, event bytes, UI render cost and storage writes for fixed 50/100/200-turn datasets. Keep instrumentation out of normal UX.
2. Maintain a latest-state identity/revision or equivalent stable change signature so unchanged snapshots are not deep-cloned, sorted and persisted repeatedly.
3. Debounce/batch browser history and IndexedDB writes while keeping the latest state durable at terminal transitions and on a best-effort page lifecycle flush. Avoid losing the final messages after Stop/Complete.
4. Avoid repeatedly cloning entire transcripts if only status/stats changed. Preserve the existing history record shape, deletion tombstones, resume/fork compatibility and `HISTORY_LIMIT` semantics.
5. For IndexedDB, do not write a session snapshot every 2.5 seconds if it has not changed. Avoid overlapping writes or out-of-order writes that could replace newer snapshots with older ones.
6. Add a bounded slow-SSE-client policy: inspect `res.writableLength` / `res.write()`, stop writing to a stalled connection after a conservative limit, close/detach it cleanly and let EventSource reconnect to a fresh authoritative state. Do **not** silently drop individual text deltas while keeping a client connected.
7. Ensure `req` / `res` close/error cleanup removes clients and write failures never crash the room's execution.
8. Preserve all current event names and message order. On reconnect, initial full state must reconstruct the transcript and streaming UI consistently.
9. Review other repeated UI listeners/intervals for duplicate binding, but only fix measured problems.

### Tests and acceptance
- Storage tests: unchanged state yields no redundant write; burst state updates yield bounded writes; final snapshot includes all messages; deleted runs never resurrect; quota-exceeded behavior remains safe.
- SSE tests: 2 clients (normal + slow), reconnect, stale sockets, failed writes, completed run reconciliation and exact event ordering.
- Benchmark goal: measurable reduction in serialization/IndexedDB write count and main-thread work with **no data loss**. Do not claim a specific percentage until benchmarked.
- No new persistence format or data migration unless justified separately.

## 6. SH-03 — Deep research URL, DNS and resource safety (P1)

### Static-review evidence
- `src/deep-research.js`: `safeResearchUrl()` / `isPrivateIp()` reject several private IPs but IPv4-mapped IPv6 and other special ranges need explicit coverage.
- `hostIsPublic()` validates a DNS lookup before a separate `fetch()`. The fetched connection may resolve differently (DNS rebinding / time-of-check-to-time-of-use risk).
- `fetchSafe()` follows manually handled redirects, which is good, but every hop must remain subject to the same checks.
- `response.text()` loads the entire response into memory before slicing the text to a character limit.

### Implementation steps
1. Centralize IP classification for IPv4, IPv6, IPv4-mapped IPv6 and IPv6 special addresses. Prefer a well-tested, maintained parser **only if** adding a dependency is justified; otherwise use exhaustive unit tests around a minimal internal implementation.
2. Deny loopback, link-local, private, unspecified, multicast, reserved and metadata-service destinations where applicable. Test hostnames resolving to mixed public/private answers, normalized IPv6 notation and redirects to private targets.
3. Close the DNS validation/use gap by binding the actual outbound connection to a previously vetted address **or** an equivalent network-layer egress policy. Merely checking DNS and then issuing a fresh ordinary `fetch()` is not sufficient for strong SSRF protection.
4. Explicitly constrain allowed scheme and port policy; allow only intended HTTP(S) traffic. If port restriction changes existing legitimate use cases, document and test the compatibility impact before enabling it.
5. Read response bodies incrementally with a hard decoded-byte ceiling, then cap extracted text length. Stop reading/cancel the stream once the limit is reached. Handle compressed responses, malformed encoding and content-type mismatches without allocating unbounded memory.
6. Apply one overall deadline/cancellation budget across redirect chain + DNS + body consumption, not independent timers that can extend a single request unexpectedly.
7. Treat fetched evidence strictly as untrusted data. Preserve existing prompt-injection boundaries and citation formatting.
8. Ensure partial failures remain nonfatal for other sources, matching current `Promise.allSettled` behavior.

### Tests and acceptance
- Extend `test/deep-research.test.js` (create if absent) with private IPv4/IPv6, IPv4-mapped IPv6, DNS rebinding/mixed resolutions, redirect chains, slow streams, oversized compressed/decompressed bodies, aborts and malformed content.
- Run security negative tests with injected mock DNS + transport; do not probe external metadata endpoints.
- Pass: unsafe destinations never receive outbound requests; size and time are bounded; legitimate public HTML research still works.

## 7. SH-04 — Local API access and deployment boundary (P0 if public, else P1)

### Static-review evidence
- `src/config.js` defaults to a loopback host; `.env.example` uses `HOST=127.0.0.1`.
- `src/server.js` exposes `/api/state`, `/api/events`, room controls, memory inspection and memory deletion without built-in authentication.
- Room IDs are identifiers, **not** access-control credentials.
- Therefore direct public deployment without a trusted authentication/access layer is unsafe; this is a conditional exposure risk, not proof of an existing public vulnerability.

### Implementation steps
1. Document supported security posture: local, single-user server bound to loopback by default. Check actual deployment topology before changing behavior.
2. If the app is served remotely, first require trusted upstream access control (e.g. authenticated reverse proxy / access gateway), HTTPS and private origin. **Do not** make the service public merely by changing `HOST=0.0.0.0`.
3. For local and remote scenarios, validate `Host` and `Origin` appropriately on state-changing browser requests; reject unsafe cross-origin attempts. Add a strict JSON Content-Type policy for JSON POST endpoints where compatible with current frontend calls.
4. Audit `/api/events`, `/api/state`, memory inspector and deletion routes for unauthorized reads/actions. Apply the same access boundary to SSE, not just POST.
5. Ensure `getPublicConfig()`, snapshots, debug events and thrown HTTP errors do not leak API keys, authorization headers, internal request payloads or private scenario roles.
6. Keep security headers conservative; do not break EventSource, math rendering or image display. Review static-file boundary and generated-image exposure.
7. Update README with explicit local-only/default-safe deployment warning and a short authenticated-proxy example/requirements **without implementing a new login UI**.
8. Confirm browser tab on localhost still works normally.

### Tests and acceptance
- Same-origin local requests succeed; disallowed Origin/Host and cross-origin mutations fail; remote deployment without approved access control is explicitly unsupported.
- Sensitive routes and SSE are covered by the access policy; no secret is exposed in JSON responses, SSE frames or diagnostic error text.
- Pass: existing local experience unchanged; public exposure cannot accidentally be described as secure without an access boundary.

## 8. SH-05 — Provider capability isolation (P2)

### Static-review evidence
- `src/provider.js`: `CAPABILITY_CACHE` uses a key derived from endpoint + model.
- `src/provider-scheduler.js` already isolates scheduling pools by endpoint + hashed credential.
- When two credentials target the same endpoint/model but have different capabilities, one negative probe can affect the other credential's future requests.

### Implementation steps
1. Reuse a non-reversible credential fingerprint in the capability-cache key alongside normalized endpoint and model; do not store plaintext API keys in cache keys/logs/diagnostics.
2. Keep the existing optimization of avoiding unnecessary capability probes on generic gateways.
3. Verify that a capability rejection (e.g. tools, vision, reasoning or stream usage) changes only the corresponding credential+endpoint+model entry.
4. Review how the cached state behaves across provider instances and concurrent requests. A proven unsupported capability can be cached; ambiguous transient network failures must not permanently mark a feature unsupported.
5. Add deterministic test cases for same credentials, different credentials, different models and simultaneous capability discovery.
6. If changing the key impacts scheduling or retry logic, scope changes tightly and record the reason.

### Tests and acceptance
- Extend `test/provider.test.js` and `test/provider-tools.test.js` (or the closest existing tests).
- Pass: credential A's unsupported feature does not disable it for credential B; same-key reuse remains effective; no plaintext secret is emitted.

## 9. SH-06 — HTTP error taxonomy, streaming edge cases and CI (P2)

### Static-review evidence
- `src/server.js` catch handler maps the circuit-open error to HTTP 503 but defaults most other failures to HTTP 400.
- An upstream 5xx, timeout or internal exception may consequently appear as a client-side input error.
- `src/provider.js` consumes streaming lines from a growing buffer; malformed/oversized SSE frames and stream interruptions deserve explicit bounds and tests.

### Implementation steps
1. Define a small internal error taxonomy: invalid input (400), missing room/resource (404 where applicable), conflict/invalid room transition (409), request too large (413), upstream unavailable/rate limited (502/503/429 as appropriate), timeout (504/408 depending semantics), and unexpected internal error (500).
2. Map existing provider error codes and AbortSignal reasons consistently. Do not expose raw provider response bodies or credentials in user-facing errors.
3. Return stable JSON error fields while retaining `error` string for current frontend compatibility. Avoid altering successful endpoint responses.
4. Validate request size in **bytes**, not just JavaScript string length, and validate JSON content type/shape for operations that require an object.
5. Cap SSE frame/line size in the provider reader, handle stream interruption distinctly from a successful `[DONE]`, and distinguish malformed data from optional harmless comment/keepalive lines. Verify against actual supported provider formats.
6. Add endpoint integration tests using an ephemeral local server and stubbed providers. Include body-too-large, bad JSON, route mismatch, stop/reset race, provider timeout, retry budget and canceled stream.
7. Extend CI to run these tests alongside existing `npm test` and `npm run check`. Keep builds deterministic and independent of live keys.

### Tests and acceptance
- Errors have accurate status/category and redacted messages; existing UI still displays intelligible errors.
- Provider streaming either produces a valid final result or fails clearly, rather than silently treating a truncated response as success.
- CI is green on the documented Node runtime.

## 10. SH-07 — Safe DOM rendering and small maintainability improvements (P2)

### Static-review evidence
- `public/lab-v2.js` interpolates configured `agent.name`, `agent.model` and a room identifier into HTML strings using `innerHTML`.
- Other UI modules often use `textContent` or escape helpers; the inconsistency is unnecessary. This is a hardening opportunity, not a confirmed external exploit under loopback-only assumptions.

### Implementation steps
1. Replace interpolation of variable values into `innerHTML` with `document.createElement()` / `textContent` / safe DOM assignment. Keep static HTML templates only for compile-time constants.
2. Audit other instances of `innerHTML`, especially strings originating from API responses, agent profiles, memory, topic, research sources or saved history.
3. Preserve markup/class names, focus behavior, event listeners and existing CSS selectors.
4. Add regression tests for special characters, HTML tags, quote characters and Unicode in agent/model names, room IDs and displayed text.
5. Avoid broad refactors of unrelated UI code. No visual redesign.

### Tests and acceptance
- Untrusted strings render as literal text; no script/HTML injection; layout and current controls remain unchanged.
- Existing UI layout and markup tests pass.

## 11. Cross-cutting QA matrix

| Test group | Required scenarios |
| --- | --- |
| Sequential | Start, auto topic, human message, pause/resume, stop, reset, limit, repeat start |
| Parallel | 2-agent and 6-agent simultaneous completion, cancellations, max-turn and ordering |
| Provider | Normal stream, tool calls, retry 429, retry-after 503, credential-isolated fallback, timeout, cut stream |
| Research | Search normal, deep-read, partial source failure, malicious URLs, bounded content |
| Memory | Agent-vs-room scope, private-context separation, forget/clear, resume, old-run cancellation |
| History | 50/100/200-turn load, delete/tombstones, quota exhausted, reload, resume/fork compatibility |
| SSE | Reconnect during stream, slow/stale clients, disconnect cleanup, snapshot reconciliation |
| Image | Direct command, active agent tool call, vision rehydration, reset during generate, file size limits |
| Scenario | Werewolf private-role isolation, allowed turn order, normal completion, no secret in public state |
| Security | Origin/Host policy, secret redaction, local-only default, forged client inputs, bounded requests |

### Performance measurements
Collect identical before/after measurements with fixed provider fixtures:
- Browser: JavaScript main-thread time, long tasks, UI responsiveness, number/duration of storage writes and approximate memory footprint.
- Backend: RSS/heap, SSE frames and bytes per run, active clients, failed writes, provider queue/TTFT unchanged unless intentionally improved.
- Functional: identical final transcript and history metadata under deterministic fixtures; no missing or duplicate entries.
- Compare median and tail behavior (p50/p95 where sample size supports it); record methodology and environment.
- A measured regression needs explanation and approval; do not declare optimization successful simply because a benchmark was not run.

## 12. PR breakdown and gates

### PR-A — Session correctness (SH-01)
Deliver: cancellation fencing, direct-image race fix, deterministic async regression tests.  
Gate G1: stop/reset/rapid-restart tests pass repeatedly and no existing behavior changes.

### PR-B — Safe research (SH-03)
Deliver: IP/DNS/connect hardening, bounded streaming reads, negative tests.  
Gate G2: no blocked-target connection, no unbounded body read, valid public pages unaffected.

### PR-C — Access boundary and error semantics (SH-04 + focused SH-06)
Deliver: local/remote security documentation, same-origin/host protections, error mapping/tests.  
Gate G2: local flows pass, security tests pass, no credential leakage.

### PR-D — Data path efficiency (SH-02)
Deliver: efficient history persistence, safe SSE slow-client handling and benchmark report.  
Gate G3: no history loss/duplicate or stream desync; objective performance gains demonstrated.

### PR-E — Provider/UI hardening (SH-05 + SH-07 + remaining SH-06)
Deliver: credential-scoped cache, safe DOM updates, streaming limits and complete CI regression suite.  
Gate G4: all tests and manual smoke matrix green; compatible documented behavior.

**PR rule:** Keep PRs small and reversible. Every PR must include: issue hypothesis, exact files changed, before/after evidence, test commands/results, compatibility discussion, residual risk and rollback instructions. Do not merge on CI green alone if high-risk negative tests or manual scenario checks are missing.

## 13. Rollback and migration guidance

- Documentation-only plan creation needs no migration or runtime rollback.
- For implementation PRs, preserve existing data formats and environmental defaults. Take a copy of `data/*.sqlite` (including WAL-related files using a safe SQLite backup procedure) before any migration; do not manually copy a live SQLite database inconsistently.
- Keep changes reversible by reverting their commit; avoid coupling bug fixes to cosmetic rewrites.
- If browser history storage must change, include backwards-compatible reads and a non-destructive migration test.
- If SSE protocol must change despite this plan's non-goal, introduce a backward-compatible transition and prove reconnect correctness.
- Validate generated-image file handling before removing orphan files.

## 14. Definition of Done

- [ ] G0 baseline captured; each claimed bug is reproduced or explicitly downgraded to preventive hardening.
- [ ] SH-01 no stale run/start/image writes.
- [ ] SH-02 redundant storage/SSE work reduced with measured evidence and no state loss.
- [ ] SH-03 unsafe outbound research blocked with bounded DNS/network/body behavior.
- [ ] SH-04 local-only defaults protected; deployment exposure risk documented and access-controlled.
- [ ] SH-05 provider capabilities isolated per credential and model.
- [ ] SH-06 accurate errors, bounded streaming, deterministic regression tests.
- [ ] SH-07 dynamic DOM content rendered safely.
- [ ] `npm test` and `npm run check` pass; manual 2–6 agent smoke matrix passes.
- [ ] No new user-facing features, unintended visual changes or data migrations.
- [ ] All relevant PRs reviewed/merged and final benchmark/security notes attached.

---

**How to use this plan with Codex:** Assign **one SH task or one PR section at a time**. Require a baseline failing test or benchmark first, then the smallest compatible implementation, then full tests and a concise evidence report. Do not instruct Codex to add features or merge without reviewing the acceptance gates above.
