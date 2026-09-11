# AI Conversation Lab v2

Runtime v2 giữ UI/logic cũ tương thích nhưng thêm một lớp orchestration mới cho 2-4 AI.

## Agent C / D

Agent A và B vẫn bắt buộc. C và D là tùy chọn: chỉ cần điền đủ `AGENT_C_*` / `AGENT_D_*` trong `.env`, reload server, UI sẽ tự thêm token card, persona và lựa chọn người mở lời.

## Multi-room

Mỗi tab browser nhận một `roomId` riêng trong `sessionStorage`. Mọi `/api/*` và SSE event được tự gắn room id, vì vậy hai tab hoặc hai người dùng không còn điều khiển chung một singleton room. Server dọn room không hoạt động theo `ROOM_TTL_MS` và giới hạn số room bằng `MAX_ROOMS`.

## Context manager

Khi transcript vượt `CONTEXT_SUMMARIZE_AFTER`, phần cũ được model nén thành conversation summary. Mỗi lượt chỉ gửi summary + `CONTEXT_RECENT_MESSAGES` gần nhất. Loop guard dùng similarity của các lượt gần đây để chèn steering tạm nếu hội thoại bắt đầu lặp.

## Web research an toàn hơn

Tavily vẫn lập plan/search như trước. Runtime v2 có thể đọc sâu top source (`WEB_RESEARCH_DEEP_*`) và đưa evidence vào role `user` bên trong `<untrusted_web_evidence>`, không ghép nội dung website vào system prompt.

## Provider resilience

OpenAI-compatible provider có timeout và circuit breaker. Sau nhiều lỗi liên tiếp, circuit mở ngắn hạn để tránh spam một gateway đang chết; thành công tiếp theo reset circuit.

## Inspector

Nút **Inspector** hiển thị timeline theo từng turn: tổng latency, first-token latency, context summary, loop guard, research query/source count, tool calls và provider diagnostics. Hover message có nút `debug` để soi riêng lượt đó.

## Fork conversation

Hover message và bấm `fork` để tạo một nhánh mới tại đúng message đó. Runtime cắt transcript, tạo run id mới rồi tiếp tục bằng prompt/model hiện tại.

## Preset

Control Room có preset Mặc định, Tranh biện, Brainstorm, Review code, Fact-check và Socratic. Preset thay shared prompt, persona và conversation mode.

## IndexedDB

Snapshot room được mirror vào IndexedDB (`ai-chat-lab-v2`) ngoài lịch sử localStorage hiện có. Local history UI vẫn giữ 50 phiên để nhẹ, còn IndexedDB là lớp persistence/backup lớn hơn cho runtime v2.
