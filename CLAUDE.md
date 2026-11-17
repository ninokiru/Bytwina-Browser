# CLAUDE.md — Quy tắc cho Nova Browser

- Ngôn ngữ trao đổi với chủ dự án: tiếng Việt, ngắn gọn.
- Chỉ làm M0 cho đến khi có bằng chứng nghiệm thu. Không làm M1 trước.
- Không tuyên bố test/build đã pass nếu chưa chạy thật. Ghi rõ lệnh đã chạy và kết quả.
- Không dùng iframe thay cho WebView2 native.
- Không push code, tạo release, hay commit secret khi chưa được phép.
- Không kiểm chứng API bằng trí nhớ: xác minh trên tài liệu chính thức trước.
- Nếu môi trường không có crates.io/npm, ghi rõ "chưa compile" thay vì giả định.
