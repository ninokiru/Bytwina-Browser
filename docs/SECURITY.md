# Bảo mật — giới hạn đã biết

- Chế độ riêng tư chỉ ngừng ghi lịch sử. Cookie và dữ liệu WebView2 vẫn được lưu; chưa cô lập profile.
- Chặn popup dựa trên danh sách tên miền tối thiểu trong `navigation.rs`. Đây không phải filter list được bảo trì và không chặn tài nguyên trong trang.
- Thư mục tải xuống: file được đặt trong thư mục Downloads của người dùng. Chưa kiểm tra loại file nguy hiểm (.exe, .bat...).
- Điều hướng link trong trang đang bị chặn (`deny_all`). Đây là lựa chọn thiết kế cần xác nhận (ADR-003).
- Lệnh IPC chỉ được gọi từ webview `toolbar` (capabilities/default.json).
