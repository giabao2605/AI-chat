# AI Conversation Lab

Web local để 2-6 AI cùng trò chuyện trong một phòng, còn người dùng có thể quan sát hoặc chen vào bất cứ lúc nào.

## Tính năng chính

- Hỗ trợ 2-6 agent: A/B bắt buộc, C-F tùy chọn; mỗi agent có model, API key và provider riêng hoặc dùng chung credential provider.
- Hai chế độ hội thoại: theo lượt hoặc chạy tự do/song song.
- Prompt/persona riêng, private context giữa đúng sender/recipient và long-term memory SQLite tách biệt theo agent/room.
- Transcript dài được nén nền; input chính có context budget deterministic theo global/per-agent để tránh context phình vô hạn.
- Inspector hiển thị latency, provider round-trip/TTFT, queue/retry, exact-vs-estimated usage và token anatomy theo category mà không dump secret plaintext.
- Provider scheduler dùng chung toàn process theo endpoint + credential, có concurrency cap, queue timeout, shared cooldown và retry có kiểm soát cho 429/503 phù hợp.
- Web research qua Tavily, có deep-read tùy chọn; evidence web được coi là dữ liệu không tin cậy chứ không phải system instruction.
- Image generation/tool loop và truyền ảnh trở lại context của agent.
- Điều khiển reasoning toàn phòng với Auto hoặc mức cố định khi provider hỗ trợ.
- Scenario Engine deterministic phía backend; hiện có Ma Sói/Werewolf cho 4-6 AI với role/secret state không đi vào public transcript/SSE/memory.
- Stream realtime bằng SSE, lịch sử phiên, resume/fork hội thoại thường, multi-room và browser persistence.
- Markdown/math rendering, dark UI với accent xanh dương nhạt.

## Chạy project

Yêu cầu **Node.js 22.13+**. Project không dùng dependency runtime ngoài Node.js.

```bash
cp .env.example .env
npm start
```

Mở:

```text
http://127.0.0.1:3000
```

Cấu hình model/API key trong `.env`. Agent A và B là bắt buộc; C-F chỉ tham gia khi được cấu hình đầy đủ. Có thể đặt `PROVIDER_API_KEY` / `PROVIDER_BASE_URL` dùng chung và override theo từng agent khi cần.

Một số control quan trọng:

```env
# Context budget; 0 = disabled
CONTEXT_INPUT_BUDGET_TOKENS=12000
CONTEXT_BUDGET_SAFETY_MARGIN=0.12
CONTEXT_IMAGE_TOKEN_RESERVE=1500

# Provider scheduler; 0 = unlimited concurrency
PROVIDER_MAX_CONCURRENT_REQUESTS=3
PROVIDER_QUEUE_TIMEOUT_MS=60000
PROVIDER_RATE_LIMIT_MAX_RETRIES=2

# Web research
TAVILY_API_KEY=tvly-your-key
WEB_SEARCH_ENABLED=true
```

Scenario Ma Sói dùng backend state machine và hiện chỉ chạy theo lượt. Scenario session có secret state chưa hỗ trợ resume/fork; hội thoại thường vẫn resume/fork bình thường.

## Kiểm tra

```bash
npm test
npm run check
```

`npm run check` tự quét JavaScript trong `src/`, `public/` và `scripts/`, nên file mới không cần được thêm thủ công vào danh sách kiểm tra.

> Không commit file `.env`, database memory, API key hoặc credential khác lên repository.
