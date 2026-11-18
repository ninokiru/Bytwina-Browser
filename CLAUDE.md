# CLAUDE.md — Quy tắc cho Bytwina Browser

- Ngôn ngữ trao đổi với chủ dự án: tiếng Việt, ngắn gọn.
- Phạm vi hiện tại: M1 + M2 (chủ dự án yêu cầu bỏ qua nghiệm thu M0, làm thẳng M1+M2 — ghi nhận 2026-11-17). Không bắt đầu M3 khi chưa được yêu cầu.
- Không tuyên bố test/build đã pass nếu chưa chạy thật. Ghi rõ lệnh đã chạy và kết quả. Code M1/M2 mới viết là CHƯA compile, CHƯA test runtime.
- Không dùng iframe thay cho WebView2 native.
- Không push code, tạo release, hay commit secret khi chưa được phép.
- Không kiểm chứng API bằng trí nhớ: xác minh trên tài liệu chính thức trước.
- Nếu môi trường không có crates.io/npm, ghi rõ "chưa compile" thay vì giả định.
