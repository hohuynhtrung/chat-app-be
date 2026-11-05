# chatbot-be

Backend Express 5 của Chat App, cung cấp API xác thực, chat, AI agent và nhận dạng giọng nói. Tài liệu đầy đủ về luồng hoạt động, API, biến môi trường và các giới hạn hiện có ở [README tổng quan](../README.md).

## Chạy local

Tạo `chatbot-be/.env` với các biến cần dùng (xem README tổng quan). `.env.example` trong thư mục này mới liệt kê một phần biến tùy chọn.

```powershell
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev
```

Server mặc định nghe cổng `3000`; API được mount dưới `/api`. Cần cấu hình `DATABASE_URL`, `CLIENT_URL`, JWT và Pusher để các chức năng tương ứng hoạt động.

## Kiểm tra

Backend hiện không khai báo script `test`. Test speech có thể chạy bằng:

```powershell
node --test test/speech.test.js
```