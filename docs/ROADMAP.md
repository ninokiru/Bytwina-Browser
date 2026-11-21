# Lộ trình

Trạng thái: **chưa biên dịch, chưa chạy thử** cho mọi mục M2–M5 (không có crates.io/npm trong môi trường làm việc; CI là nơi kiểm tra duy nhất).

- [x] M0 — Nền tảng kỹ thuật (prototype đa WebView2; chưa nghiệm thu trên Windows)
- [x] M8 — Kiểm thử và ổn định (test tự động đã viết, checklist Windows chưa chạy; xem docs/TESTING.md)
- [~] M9 — Phát hành 1.0 (phần không cần hạ tầng: CHANGELOG, USER_GUIDE, SUPPORT; ký số, cập nhật, website chưa làm)
- [~] M10 — Trải nghiệm nâng cao (đã làm: tìm tab, danh sách đọc, theme sáng/tối, tab ngủ, tra từ điển, chia màn hình, workspace; chưa làm: quick actions, per-site, PiP, cử chỉ)
- [~] M1 — Nền tảng trình duyệt: thanh địa chỉ, điều hướng, tab, trang tab mới
  - [x] Trang tab mới trong webview toolbar: ô tìm kiếm lớn, chọn công cụ tìm kiếm, quick link từ dấu trang/lịch sử, gợi ý khi rỗng (chưa kiểm chứng runtime trên Windows)
  - [ ] Phím tắt toàn cục (Ctrl+T/W/L/R hiện chỉ hoạt động khi focus vào toolbar)
  - [x] Popup: chặn cửa sổ mới, URL hợp lệ mở thành tab nền (hàng đợi 16 mục)
- [~] M2 — Dữ liệu: SQLite (bookmark, lịch sử, cài đặt, phiên, ghi chú). Schema v5.
  - [x] Phiên lưu cả tab ghim và nhóm tab
  - [x] Phiên lưu có tên (bảng `saved_sessions`), khôi phục/xóa từ menu và Cài đặt; tự lưu mỗi 60 giây
  - [x] Ghi chú gắn URL (bảng `page_notes`), Markdown + ammonia, xuất `.md`
  - [ ] Sao lưu/khôi phục DB, WAL checkpoint khi thoát
  - [ ] Tách profile: đã có thư mục dữ liệu riêng theo workspace; còn thiếu sao lưu và chọn profile mặc định (chưa kiểm chứng runtime)
- [~] M3 — Tải xuống
  - [x] Sự kiện `on_download`: chọn thư mục Downloads, tránh ghi đè, ghi lịch sử tải vào DB
  - [x] Danh sách tải xuống trong panel "⤓"; xóa danh sách
  - [ ] Hiển thị tiến độ, hủy tải, mở thư mục chứa file
  - [ ] Kiểm tra toàn vẹn file (checksum)
- [~] M4 — Riêng tư và bảo mật
  - [x] Chế độ riêng tư: không ghi lịch sử (cookie vẫn được lưu; xem docs/SECURITY.md)
  - [x] Xóa dữ liệu duyệt web (lịch sử, tải xuống, phiên)
  - [x] Chặn popup theo danh sách quảng cáo tối thiểu (không phải filter list bảo trì)
  - [~] Chặn tài nguyên quảng cáo/tracker trong trang (ADR-015)
    - [x] Engine adblock-rs 0.13 (bỏ `single-thread`), tải EasyList/EasyPrivacy/uBlock/ABPVN, cache engine đã serialize
    - [x] IPC: `adblock_status`, `adblock_set`, `adblock_site`, `adblock_update`, `adblock_reload`
    - [x] Mục Cài đặt: bật/tắt, số danh sách đang dùng, số request đã chặn, nút cập nhật
    - [ ] Nối `WebResourceRequested` (đang làm — code COM webview2-com 0.39)
    - [ ] M4b: ẩn phần tử (cosmetic) + scriptlet, bộ đếm theo tab, nút khiên trên ô địa chỉ
  - [x] Quản lý quyền site (WebView2 permission handler, chưa kiểm chứng runtime)
  - [x] Điều hướng link trong trang theo chính sách HTTPS-first (ADR-003, ADR-011)
- [~] M5 — Tính năng nâng cao
  - [x] Ghim tab (tab ghim nằm đầu thanh tab)
  - [x] Nhóm tab (gán tên nhóm, hiển thị tiền tố `[nhóm]`)
  - [x] Tab dọc: thanh công cụ thành cột trái 260 px, tab xếp dọc (chưa kiểm chứng runtime)
  - [x] Chia màn hình: hai webview cạnh nhau, đổi ô phải bằng danh sách tab
  - [ ] Reader mode (cần chèn script vào trang; chưa quyết định)
  - [ ] PDF: phụ thuộc WebView2, chưa kiểm tra
  - [x] Trang tab mới có giao diện riêng
- [~] M6 — Hiệu năng
  - [x] Giảm việc ở đường nóng: label cache, `created_labels()` thay `snapshot()` trong layout/ẩn tab/zoom, layout bỏ sự kiện trùng, vòng 30s không gửi trạng thái thừa (ADR-016)
  - [x] Micro-probe trong Rust (`-- --ignored`) + workflow `benchmarks.yml` in số vào Summary
  - [x] `strip = true`; feature `alloc-mimalloc` để A/B bộ cấp phát (mặc định tắt)
  - [ ] Số đo thật trên máy Windows: cold/warm startup, RAM rảnh, 1/5/10 tab, chuyển tab, CPU nền (`scripts/bench.ps1`)
  - [ ] Điều chỉnh ngưỡng tab ngủ và chính sách giữ trạng thái theo số đo
- [ ] M7 — Phát hành


## M10–M15: trạng thái đề xuất
- M10 còn lại, M12, M13, M14, M15: đã viết ADR đề xuất (xem docs/DECISIONS.md, ADR-004 đến ADR-009).
- M11: đã làm kho mật khẩu cục bộ (Argon2id + AES-256-GCM, xem docs/SECURITY.md); chưa có tự động điền/bắt mật khẩu, chưa kiểm chứng runtime trên Windows.
- M12 và M13 là thay đổi kiến trúc cần ADR được chấp nhận trước; M15 có phần cần API chưa kiểm chứng và một phần mâu thuẫn nguyên tắc bảo mật.

## Cập nhật: M14 đã bỏ; M15 (bảo mật) đã làm phần cục bộ
- M14: đã bỏ theo quyết định của chủ dự án.
- M15: xem bảng trạng thái trong docs/SECURITY.md. Các mục còn lại cần WebView2 API đã kiểm chứng, dịch vụ bên ngoài, hoặc quyết định ADR-003.
