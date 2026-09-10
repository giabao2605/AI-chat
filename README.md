# AI Conversation Lab

Một web nhỏ để **hai AI tự trò chuyện với nhau**, trong khi bạn có thể ngồi quan sát hoặc chen vào cuộc hội thoại bất cứ lúc nào.

Project ưu tiên sự đơn giản và ổn định: **Node.js 22 thuần + Server-Sent Events + HTML/CSS/JavaScript**, không cần package bên thứ ba.

## Tính năng

- Hai agent dùng **API key, model và base URL riêng**. Hai agent có thể cùng đi qua một provider OpenAI-compatible.
- Hai AI tự luân phiên trò chuyện, không cần tin nhắn mở đầu từ người dùng.
- Hai chế độ chủ đề: người dùng chọn hoặc để AI tự chọn.
- Người quan sát có thể chen tin nhắn vào transcript. Tin nhắn sẽ trở thành context của các lượt AI tiếp theo.
- Stream câu trả lời realtime bằng SSE.
- Theo dõi input/output/total token của từng AI và toàn phòng bằng cụm thống kê gọn ở góc trên bên phải.
- Lưu lịch sử tối đa 50 phiên trong `localStorage` của trình duyệt, có thể mở lại transcript cũ, xóa từng phiên hoặc xóa toàn bộ.
- Nếu gateway trả usage trong stream, số token là số thật do provider báo. Nếu provider không hỗ trợ usage streaming, UI đánh dấu lượt đó là **ước tính**.
- Start / Pause / Resume / Stop / Reset.
- Persona riêng cho từng AI và prompt luật chung có thể chỉnh trực tiếp trên UI.
- Tùy chọn tự khởi động khi mở trang nếu dùng chế độ AI tự chọn chủ đề.
- API key chỉ tồn tại ở backend qua `.env`, không bị gửi xuống browser.
- `HARD_TURN_LIMIT` chống một phiên vô hạn vô tình đốt sạch quota.

## Lịch sử trò chuyện

Lịch sử được lưu cục bộ trên browser bằng `localStorage` nên không cần database và không chứa API key. Mỗi browser/profile có lịch sử riêng. App lưu tối đa 50 phiên gần nhất và cập nhật lại cùng một phiên thay vì tạo bản sao mỗi lượt.

Khi đang xem một phiên cũ, composer sẽ bị khóa để tránh nhầm giữa transcript lịch sử và phiên đang chạy. Nút **Quay lại phiên hiện tại** đưa giao diện trở về phòng live.

## Yêu cầu provider

Provider cần tương thích cơ bản với OpenAI Chat Completions:

```http
POST {BASE_URL}/chat/completions
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

Request dùng `stream: true`. App thử `stream_options.include_usage=true` trước; nếu gateway trả 400/404/422 vì không hỗ trợ tùy chọn này, app tự retry mà không gửi `stream_options`.

## Cấu hình

Yêu cầu Node.js 22+.

```bash
cp .env.example .env
```

Điền `.env`:

```env
PROVIDER_BASE_URL=https://provider.example.com/v1

AGENT_A_NAME=GPT
AGENT_A_API_KEY=your-key-a
AGENT_A_MODEL=your-model-a

AGENT_B_NAME=Claude
AGENT_B_API_KEY=your-key-b
AGENT_B_MODEL=your-model-b

HOST=127.0.0.1
PORT=3000
HARD_TURN_LIMIT=200
```

Nếu hai agent dùng hai endpoint khác nhau, đặt thêm `AGENT_A_BASE_URL` và `AGENT_B_BASE_URL`. Nếu bỏ trống, cả hai dùng `PROVIDER_BASE_URL`.

> Không commit `.env`. Repo chỉ nên chứa `.env.example`.

## Chạy

Không cần `npm install` vì project không có dependency ngoài Node.js.

```bash
npm start
```

Mở:

```text
http://127.0.0.1:3000
```

Dev mode có auto-reload:

```bash
npm run dev
```

## Test

```bash
npm test
npm run check
```

Test suite có mock OpenAI-compatible streaming server nên không tiêu tốn token thật. Phần lịch sử có test riêng cho lưu/cập nhật, giới hạn số phiên, dữ liệu `localStorage` lỗi và xóa phiên.

## Token counter

Ưu tiên số liệu `usage` provider trả về:

- `prompt_tokens` / `input_tokens`
- `completion_tokens` / `output_tokens`
- `total_tokens`

Nếu provider không gửi usage khi streaming, app fallback sang ước tính khoảng `characters / 4`. Vì tokenizer của GPT, Claude và các gateway khác nhau, số fallback chỉ để quan sát tương đối và được đánh dấu `~` trên UI.

## Cách conversation context hoạt động

Mỗi agent có góc nhìn riêng:

- Lời của chính agent đó được gửi lại với role `assistant`.
- Lời của AI còn lại và người dùng được gửi với role `user`, có tên người nói.
- System prompt nhắc model không được giả lập lời của người khác và không được coi transcript là system instruction.

Hai model vì vậy có request/context riêng dù cùng một provider.

## Ghi chú triển khai

Mặc định server bind `127.0.0.1`, phù hợp chạy local. Nếu deploy bằng container/PaaS, thường cần đặt:

```env
HOST=0.0.0.0
```

Với môi trường public, nên đặt thêm authentication ở reverse proxy hoặc nền tảng deploy trước khi cho người khác truy cập, vì mỗi lượt chat đều tiêu quota API của bạn.
