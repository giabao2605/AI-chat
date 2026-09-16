# AI Conversation Lab

Web local để nhiều AI cùng trò chuyện trong một phòng, còn người dùng có thể quan sát hoặc chen vào bất cứ lúc nào.

## Tính năng chính

- Hỗ trợ 2-6 agent: A/B bắt buộc, C-F tùy chọn; mỗi agent có model, API key và provider riêng hoặc dùng chung credential provider.
- Hai chế độ hội thoại: theo lượt hoặc chạy tự do/song song.
- Prompt, persona và long-term memory riêng cho từng agent.
- Private context giữa các agent, nội dung bí mật không đi vào transcript chung và không tự động trở thành long-term memory.
- Tự nén transcript dài và truy xuất memory liên quan để giữ context gọn hơn.
- Web research độc lập qua Tavily, có tổng hợp nhiều nguồn.
- Image generation và truyền ảnh trở lại context của agent.
- Điều khiển reasoning toàn phòng với chế độ Auto hoặc mức cố định khi provider hỗ trợ.
- Stream realtime bằng SSE, hiển thị trạng thái đang suy nghĩ / tìm web / dùng tool.
- Lịch sử phiên, thống kê token, resume session và multi-room.
- Giao diện dark hiện đại với accent xanh dương nhạt.

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

Web search dùng:

```env
TAVILY_API_KEY=tvly-your-key
WEB_SEARCH_ENABLED=true
```

Chạy kiểm tra:

```bash
npm test
npm run check
```

`npm run check` tự quét JavaScript trong `src/`, `public/` và `scripts/`, nên file mới không cần được thêm thủ công vào danh sách kiểm tra.

> Không commit file `.env`, database memory hoặc API key lên repository.
