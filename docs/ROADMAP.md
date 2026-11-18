# Lộ trình

Trạng thái: **chưa biên dịch, chưa chạy thử** cho mọi mục M2–M5 (không có crates.io/npm trong môi trường làm việc; CI là nơi kiểm tra duy nhất).

- [x] M0 — Nền tảng kỹ thuật (prototype đa WebView2; chưa nghiệm thu trên Windows)
- [x] M8 — Kiểm thử và ổn định (test tự động đã viết, checklist Windows chưa chạy; xem docs/TESTING.md)
- [~] M9 — Phát hành 1.0 (phần không cần hạ tầng: CHANGELOG, USER_GUIDE, SUPPORT; ký số, cập nhật, website chưa làm)
- [~] M10 — Trải nghiệm nâng cao (đã làm: tìm tab, danh sách đọc; chưa làm: split view, workspace, quick actions, per-site, theme, tab sleep, PiP, cử chỉ)
- [~] M1 — Nền tảng trình duyệt: thanh địa chỉ, điều hướng, tab, trang tab mới (`about:blank`)
  - [ ] Phím tắt toàn cục (Ctrl+T/W/L/R hiện chỉ hoạt động khi focus vào toolbar)
  - [x] Popup: chặn cửa sổ mới, URL hợp lệ mở thành tab nền (hàng đợi 16 mục)
- [~] M2 — Dữ liệu: SQLite (bookmark, lịch sử, cài đặt, phiên). Schema v2.
  - [x] Phiên lưu cả tab ghim và nhóm tab
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
  - [x] Điều hướng link trong trang theo chính sách HTTPS-first (ADR-003, ADR-011)
- [~] M5 — Tính năng nâng cao
  - [x] Ghim tab (tab ghim nằm đầu thanh tab)
  - [x] Nhóm tab (gán tên nhóm, hiển thị tiền tố `[nhóm]`)
  - [ ] Tab dọc (cần thay đổi bố cục Rust: toolbar hiện có chiều cao cố định)
  - [ ] Reader mode (cần chèn script vào trang; chưa quyết định)
  - [ ] PDF: phụ thuộc WebView2, chưa kiểm tra
  - [ ] Trang tab mới có giao diện riêng
- [ ] M6 — Hiệu năng (chưa có số đo)
- [ ] M7 — Phát hành


## M10–M15: trạng thái đề xuất
- M10 còn lại, M11, M12, M13, M14, M15: đã viết ADR đề xuất (xem docs/DECISIONS.md, ADR-004 đến ADR-009). Chưa có code.
- Lý do: M11 và M14 cần hạ tầng hoặc quyết định chưa có; M12 và M13 là thay đổi kiến trúc cần ADR được chấp nhận trước; M15 có phần cần API chưa kiểm chứng và một phần mâu thuẫn nguyên tắc bảo mật.

## Cập nhật: M14 đã bỏ; M15 (bảo mật) đã làm phần cục bộ
- M14: đã bỏ theo quyết định của chủ dự án.
- M15: xem bảng trạng thái trong docs/SECURITY.md. Các mục còn lại cần WebView2 API đã kiểm chứng, dịch vụ bên ngoài, hoặc quyết định ADR-003.
