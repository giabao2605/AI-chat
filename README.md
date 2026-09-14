# AI Conversation Lab

Web local để nhiều AI cùng trò chuyện trong một phòng, còn người dùng có thể quan sát hoặc chen vào bất cứ lúc nào.

## Tính năng chính

- Hỗ trợ 2 agent bắt buộc và Agent C/D tùy chọn, mỗi agent có model, API key và provider riêng.
- Hai chế độ hội thoại: theo lượt hoặc chạy tự do/song song.
- Prompt, persona và long-term memory riêng cho từng agent.
- Private context giữa các agent, nội dung bí mật không đi vào transcript chung.
- Tự nén transcript dài và truy xuất memory liên quan để giữ context gọn hơn.
- Web research độc lập qua Tavily, có tổng hợp nhiều nguồn.
- Image generation và truyền ảnh trở lại context của agent.
- Stream realtime bằng SSE, hiển thị trạng thái đang suy nghĩ / tìm web / dùng tool.
- Lịch sử phiên, thống kê token, resume session và multi-room.
- Giao diện dark hiện đại với accent xanh dương nhạt.

## Chạy project

Yêu cầu **Node.js 22.13+**. Project không dùng dependency ngoài Node.js.

```bash
cp .env.example .env
npm start
```

Mở:

```text
http://127.0.0.1:3000
```

Cấu hình model/API key trong `.env`. Agent A và B là bắt buộc; C và D chỉ tham gia khi được cấu hình đầy đủ.

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

> Không commit file `.env`, database memory hoặc API key lên repository.
