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
- Giao diện mới: thanh công cụ hai hàng, tab dạng viên, omnibox, trạng thái rỗng cho từng bảng, icon SVG thay emoji; theme sáng/tối dùng chung một hệ biến CSS.
- Logo thương hiệu cho giao diện, cửa sổ và bộ cài (ICO 16–256 px, nền thẻ trắng để mark đen rõ trên thanh tác vụ tối).
- `preview.html` + `src/preview.tsx`: xem trước giao diện trong trình duyệt thường bằng IPC giả lập (chỉ dùng khi phát triển).

### Sửa
- Bảng nổi (dấu trang, lịch sử, cài đặt…) bị cắt vì chỉ cao 96 px: mở bảng thì nới webview toolbar phủ cửa sổ và ẩn webview nội dung, đóng thì trả lại bố cục; bảng không còn bị giới hạn chiều cao.
- Cài đặt chuyển từ style inline sang lớp CSS dùng chung; thêm thông báo trạng thái rỗng, nút xóa nguy hiểm và chẩn đoán dạng bảng.
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

