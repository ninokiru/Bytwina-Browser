# Bảo mật — giới hạn đã biết

- Chế độ riêng tư chỉ ngừng ghi lịch sử. Cookie và dữ liệu WebView2 vẫn được lưu; chưa cô lập profile.
- Chặn popup dựa trên danh sách tên miền tối thiểu trong `navigation.rs`. Đây không phải filter list được bảo trì và không chặn tài nguyên trong trang.
- Thư mục tải xuống: file được đặt trong thư mục Downloads của người dùng. Chưa kiểm tra loại file nguy hiểm (.exe, .bat...).
- Trang http không mã hóa (trừ localhost) bị chặn theo HTTPS-first (ADR-011). Chưa có cách cho phép thủ công từng trang.
- Lệnh IPC chỉ được gọi từ webview `toolbar` (capabilities/default.json).

## Trạng thái các biện pháp bảo mật (M15)

| Biện pháp | Trạng thái |
|---|---|
| IPC chỉ cho webview `toolbar` (capabilities) | Đã cấu hình |
| Trang web không có quyền gọi lệnh Tauri | Đã cấu hình (không có capability cho nội dung) |
| Chặn giao thức nguy hiểm (javascript:, file:, data:) khi nhập địa chỉ | Đã có, có test |
| Điều hướng trong trang theo chính sách HTTPS-first | Đã có, có test (ADR-011) |
| Chặn popup theo danh sách tối thiểu | Đã có, có test |
| File thực thi/script tải về đổi đuôi `.download` | Đã có, có test |
| Xóa lịch sử theo tên miền | Đã có, có test (khớp đúng tên miền, không khớp tên miền con) |
| Không có telemetry / gửi dữ liệu ra ngoài | Đã kiểm tra mã: không có mã mạng trong app |
| Điều khoản và quyền riêng tư khi mở lần đầu | Đã có (bản nháp) |
| Chính sách quyền site (camera, micro, vị trí…) | CHƯA làm: cần khảo sát WebView2 PermissionRequested; hiện từ chối mặc định của WebView2 |
| HTTPS-first | Một phần: chặn http trang khác; chưa nâng cấp tự động link trong trang |
| Chặn tài nguyên quảng cáo/tracker trong trang | CHƯA làm: cần WebResourceRequested |
| Cô lập cookie theo hồ sơ | CHƯA làm |
| Mã hóa dữ liệu cục bộ (SQLite) | CHƯA làm |
| Kiểm tra lừa đảo qua nguồn đáng tin cậy | CHƯA làm: cần dịch vụ bên ngoài |
| Cập nhật bảo mật | Quét phụ thuộc định kỳ (security.yml); cập nhật tự động chưa kích hoạt |
| Content Security Policy cho giao diện | CHƯA bật: cần kiểm thử IPC trước vì sai CSP sẽ làm hỏng toolbar |
