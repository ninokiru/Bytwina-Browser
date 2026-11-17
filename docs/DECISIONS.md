# Quyết định kiến trúc (ADR)

## ADR-001: Dùng Window::add_child để đặt WebView2 native trong cửa sổ

- **Trạng thái:** Chấp nhận cho M0–M2; cần đánh giá lại trước production.
- **Bối cảnh:** Trình duyệt phải dùng WebView2 native, không dùng iframe.
- **Quyết định:** Dùng `tauri::Window::add_child(WebviewBuilder, position, size)`.
- **Rủi ro đã xác minh (docs.rs, Tauri 2.12.6):**
  - Hàm chỉ khả dụng với feature `unstable`. Prototype bật feature này trong `Cargo.toml`.
  - Trên Windows, hàm có thể deadlock nếu gọi từ command đồng bộ hoặc event handler. Mọi command gọi `add_child` phải là `async`.
- **Hệ quả:** Có thể bị thay đổi ở bản Tauri sau. Trước M1 cần quyết định giữ hay thay thế.
- **Phương án thay thế:** Tách trình duyệt thành cửa sổ/tiến trình riêng, hoặc dùng API WebView không thuộc Tauri (wry trực tiếp).

## ADR-002: Một lệnh IPC duy nhất cho toàn bộ thao tác của toolbar

- **Trạng thái:** Chấp nhận (M1).
- **Bối cảnh:** Webview nội dung là trang web xa, không bao giờ được gọi IPC; chỉ toolbar tin cậy được gọi (capabilities/default.json). Số lượng thao tác trình duyệt sẽ tăng nhiều theo milestone.
- **Quyết định:** Toolbar gọi một lệnh `browser_command(action, args)` (action dạng chuỗi, args JSON). Backend kiểm tra action trong danh sách tường minh.
- **Lý do:** Giảm bề mặt capability, tránh trùng tên lệnh, dễ mở rộng ở M2–M5 mà không sửa capabilities.
- **Đánh đổi:** Mất type-check tự động giữa TS và Rust ở biên IPC — bù bằng cách định nghĩa payload trong `src/tabs.ts` và test Rust cho parsing action.

## ADR-003: Chặn mọi điều hướng phía trang; URL chỉ đổi qua toolbar

- **Trạng thái:** Chấp nhận (M1).
- **Bối cảnh:** Back/forward/history của tab phải là sự thật duy nhất giữa frontend và backend. WebView2 native child không có API back/forward phía Tauri.
- **Quyết định:** Mỗi webview nội dung đăng ký `on_navigation` trả `false` với mọi URL. Trang web không tự chuyển location, không bấm link ngoài. Mọi điều hướng đi qua toolbar → `Webview::navigate` (bỏ qua on_navigation). Lịch sử back/forward tự quản trong `BrowserState` (giới hạn 50 mục/tab).
- **Hạn chế đã biết:** Người dùng không click được link trong trang — đây là giới hạn tạm thời của M1, sẽ xử lý ở M4/M5 bằng cơ chế cho phép điều hướng cùng origin có kiểm soát. Ghi rõ trong docs/SECURITY.md khi hoàn thiện.

## ADR-004: Popup chặn hoàn toàn, hàng đợi mở tab nền khi được phép

- **Trạng thái:** Chấp nhận (M1).
- **Bối cảnh:** `window.open`/target=_blank phải xử lý an toàn; không tạo của sổ lạ che toolbar.
- **Quyết định:** `on_new_window` luôn trả `NewWindowResponse::Deny`. Khi toolbar báo người dùng giữ Ctrl (`popup_allow`), URL popup vào `PopupQueue`; toolbar poll `popup_drain` và mở tab nền mới. Hàng đợi chặn 16 mục chống spam.
- **Ghi chú:** Webview nội dung không có bridge Tauri nên không thể tự xin quyền; permission manager đầy đủ ở M4.

## ADR-005: rusqlite + bundled cho SQLite

- **Trạng thái:** Chấp nhận (M2).
- **Bối cảnh:** Spec yêu cầu SQLite cho bookmarks/history/preferences/session, có migrations, WAL, transaction, không block UI thread.
- **Quyết định:** `rusqlite` bản `bundled` (compile SQLite kèm app — không phụ thuộc runtime hệ thống), kết nối bọc `Arc<Mutex<Connection>>`, mở tại `app_data_dir/nova.db`, WAL + synchronous=NORMAL, bảng `schema_version` cho versioning. Lệnh DB chạy trong command async (luồng tokio), giữ khóa mutex ngắn.
- **Lý do chọn rusqlite thay vì sqlx/diesel:** đồng bộ, ít phụ thuộc, hợp máy dev 8 GB; sqlx async-heavy và diesel thiên về server SQL lớn.
- **Giới hạn:** Một connection duy nhất; nếu M6 đo thấy contention thì tách read pool.
