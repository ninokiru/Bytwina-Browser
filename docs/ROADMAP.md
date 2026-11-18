# Lộ trình

Trạng thái: **chưa biên dịch, chưa chạy thử** cho mọi mục M2–M5 (không có crates.io/npm trong môi trường làm việc; CI là nơi kiểm tra duy nhất).

- [x] M0 — Nền tảng kỹ thuật (prototype đa WebView2; chưa nghiệm thu trên Windows)
- [~] M1 — Nền tảng trình duyệt: thanh địa chỉ, điều hướng, tab, trang tab mới (`about:blank`)
  - [ ] Phím tắt toàn cục (Ctrl+T/W/L/R hiện chỉ hoạt động khi focus vào toolbar)
  - [~] Popup: chặn mặc định, mở tab nền khi giữ Ctrl (đã có hàng đợi)
- [~] M2 — Dữ liệu: SQLite (bookmark, lịch sử, cài đặt, phiên). Mã M2 có sẵn trên `main`, còn lỗi biên dịch.
  - [ ] Sao lưu/khôi phục DB, WAL checkpoint khi thoát
  - [ ] Tách profile (cần nghiên cứu WebView2 user data folder)
- [~] M3 — Tải xuống
  - [x] Sự kiện `on_download`: chọn thư mục Downloads, tránh ghi đè, ghi lịch sử tải vào DB
  - [x] Danh sách tải xuống trong panel "⤓"; xóa danh sách
  - [ ] Hiển thị tiến độ, hủy tải, mở thư mục chứa file
  - [ ] Kiểm tra toàn vẹn file (checksum)
- [~] M4 — Riêng tư và bảo mật
  - [x] Chế độ riêng tư: không ghi lịch sử (cookie vẫn được lưu; xem docs/SECURITY.md)
  - [x] Xóa dữ liệu duyệt web (lịch sử, tải xuống, phiên)
  - [x] Chặn popup theo danh sách quảng cáo tối thiểu (không phải filter list bảo trì)
  - [ ] Chặn tài nguyên quảng cáo/tracker trong trang (cần WebResourceRequested)
  - [ ] Quản lý quyền site (WebView2 permission handler, chưa khảo sát)
  - [ ] Điều hướng link trong trang: hiện đang bị chặn bởi `deny_all` (xem ADR-003)
- [~] M5 — Tính năng nâng cao
  - [x] Ghim tab (tab ghim nằm đầu thanh tab)
  - [x] Nhóm tab (gán tên nhóm, hiển thị tiền tố `[nhóm]`)
  - [ ] Tab dọc (cần thay đổi bố cục Rust: toolbar hiện có chiều cao cố định)
  - [ ] Reader mode (cần chèn script vào trang; chưa quyết định)
  - [ ] PDF: phụ thuộc WebView2, chưa kiểm tra
  - [ ] Trang tab mới có giao diện riêng
- [ ] M6 — Hiệu năng (chưa có số đo)
- [ ] M7 — Phát hành
