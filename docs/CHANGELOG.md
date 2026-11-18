# Nhật ký thay đổi

## Chưa phát hành
### Thêm
- Tab: thanh địa chỉ, điều hướng, ghim tab, nhóm tab, tìm tab.
- Dữ liệu: dấu trang, lịch sử, cài đặt, phiên (khôi phục khi mở lại, lưu mỗi 30 giây).
- Tải xuống: danh sách, không ghi đè file.
- Riêng tư: không ghi lịch sử; xóa dữ liệu duyệt web.
- Danh sách đọc.
- Chẩn đoán và nhật ký `bytwina.log`.
- Chặn popup theo danh sách tối thiểu.

### Sửa
- Tab mới (＋ hoặc Ctrl+T) được kích hoạt ngay; con trỏ vào ô địa chỉ.
- Đóng tab cuối cùng tự mở tab trống thay vì để cửa sổ rỗng.
- Đóng tab đang hoạt động chọn tab kề theo thứ tự hiển thị (đúng cả khi có tab ghim).
- Phiên làm việc lưu cả trạng thái ghim và tên nhóm; DB bản cũ tự nâng cấp lên schema v2.
- Bật/tắt chế độ riêng tư nạp lại các tab để dùng profile InPrivate, không tiếp tục dùng cookie của profile thường.
- Popup hợp lệ mở thành tab nền (hàng đợi tối đa 16); bỏ cơ chế "giữ Ctrl" vốn không có cách báo từ trang.
- Nhập `localhost:3000` hoặc `host:port` mở đúng URL thay vì tìm kiếm.
- Tìm trong lịch sử chờ 250 ms sau khi ngừng gõ, không truy vấn DB mỗi phím.
- CI: thêm `package-lock.json`, `Cargo.lock`, `.gitignore`; bộ cài NSIS khai báo icon.

### Biết trước (chưa sửa)
- Trang http không mã hóa bị chặn (ADR-011).
- Chế độ riêng tư chưa tách dữ liệu hồ sơ trên đĩa (WebView2 dùng chung user data folder).
- Tab dọc, reader mode, cập nhật tự động, ký số: chưa có.

