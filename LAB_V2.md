# AI Conversation Lab v2

Runtime v2 giữ UI/logic cũ tương thích nhưng mở rộng orchestration lên 2-6 AI.

## Agent C-F

Agent A và B vẫn bắt buộc. C, D, E và F là tùy chọn: cấu hình model cùng API key/base URL riêng hoặc dùng `PROVIDER_API_KEY` / `PROVIDER_BASE_URL` chung trong `.env`. Khi agent được cấu hình đầy đủ, runtime và UI sẽ đưa agent đó vào phòng, token stats và lựa chọn người mở lời.

## Multi-room

Khi `MULTI_ROOM_ENABLED=true`, mỗi tab browser nhận một `roomId` riêng trong `sessionStorage`. Mọi `/api/*` và SSE event được tự gắn room id, vì vậy hai tab hoặc hai người dùng không điều khiển chung một singleton room. Server dọn room không hoạt động theo `ROOM_TTL_MS` và giới hạn số room bằng `MAX_ROOMS`.

## Context manager

Khi transcript vượt `CONTEXT_SUMMARIZE_AFTER`, phần cũ được nén thành conversation summary. Mỗi lượt gửi summary + `CONTEXT_RECENT_MESSAGES` gần nhất. Bản summary trong profiled runtime có provisional digest tức thời và refresh nền để tránh chặn lượt chính. Loop guard dùng similarity của các lượt gần đây để chèn steering tạm nếu hội thoại bắt đầu lặp, áp dụng cho toàn bộ agent đang cấu hình A-F.

## Long-term memory và private context

Long-term memory được lưu bằng SQLite và truy xuất theo agent/room tùy cấu hình. Private context là state riêng của phiên giữa đúng sender/recipient; nó không đi vào transcript chung và không được tự động promote thành long-term memory.

## Web research an toàn hơn

Tavily lập plan/search như trước. Runtime v2 có thể đọc sâu top source (`WEB_RESEARCH_DEEP_*`) và đưa evidence vào role `user` bên trong `<untrusted_web_evidence>`, không ghép nội dung website vào system prompt.

## Provider resilience

OpenAI-compatible provider có timeout, capability fallback có kiểm soát và circuit breaker. Capability không được hỗ trợ chỉ bị tắt khi provider trả lỗi chỉ rõ feature tương ứng, tránh retry mù gây thêm latency.

## Reasoning control

Room hỗ trợ Auto hoặc mức reasoning cố định khi provider/model chấp nhận `reasoning_effort`. Chế độ manual được probe trước trên provider không thể xác minh trực tiếp; Auto dùng adaptive reasoning của runtime.

## Inspector

Nút **Inspector** hiển thị debug theo từng turn: tổng latency, first-token latency, context summary, loop guard, research query/source count, tool calls và provider diagnostics. Hover message có nút `debug` để soi riêng lượt đó.

## Fork conversation

Hover message và bấm `fork` để tạo một nhánh mới tại đúng message đó. Runtime cắt transcript, tạo run id mới rồi tiếp tục bằng prompt/model hiện tại; turn accounting áp dụng cho toàn bộ A-F.

## Preset

Preset Mặc định, Tranh biện, Brainstorm, Review code, Fact-check và Socratic vẫn được implement trong `lab-v2.js`, nhưng UI preset hiện đang ẩn. Không dựa vào preset như một control surface công khai cho tới khi product decision thay đổi.

## IndexedDB

Snapshot room được mirror vào IndexedDB (`ai-chat-lab-v2`) ngoài lịch sử localStorage hiện có. Local history UI vẫn giữ tập phiên nhẹ hơn, còn IndexedDB là lớp persistence/backup lớn hơn cho runtime v2.
