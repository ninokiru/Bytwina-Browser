# Quyết định kiến trúc (ADR)

## ADR-001: Dùng Window::add_child để đặt WebView2 native trong cửa sổ

- **Trạng thái:** Chấp nhận cho prototype M0; cần đánh giá lại trước production.
- **Bối cảnh:** Trình duyệt phải dùng WebView2 native, không dùng iframe.
- **Quyết định:** Dùng `tauri::Window::add_child(WebviewBuilder, position, size)`.
- **Rủi ro đã xác minh (docs.rs, Tauri 2.x (docs.rs phiên bản 2.12.6 tại thời điểm kiểm tra)):**
  - Hàm chỉ khả dụng với feature `unstable`. Prototype bật feature này trong `Cargo.toml`.
  - Trên Windows, hàm có thể deadlock nếu gọi từ command đồng bộ hoặc event handler. Mọi command gọi `add_child` phải là `async`.
- **Hệ quả:** Có thể bị thay đổi ở bản Tauri sau. Trước M1 cần quyết định giữ hay thay thế.
- **Phương án thay thế:** Tách trình duyệt thành cửa sổ/tiến trình riêng, hoặc dùng API WebView không thuộc Tauri (wry trực tiếp).

## ADR-002: Nút quay lại/tiến dùng History API của trang

- **Trạng thái:** Chấp nhận cho M1.
- **Bối cảnh:** Tài liệu docs.rs (Tauri 2) không có `back`/`forward` trên `Webview`; chỉ có `navigate`, `reload`, `url`.
- **Quyết định:** Quay lại/tiến dùng `eval("history.back()")` / `eval("history.forward()")` trên tab đang hoạt động.
- **Hệ quả và giới hạn:**
  - Đây là đoạn script chạy trong trang từ xa. Nó không đọc dữ liệu trang và không cấp quyền IPC, nhưng vẫn là can thiệp vào trang.
  - Không hoạt động với điều hướng khởi tạo bởi `location.replace` hoặc khi lịch sử trống.
  - Cần xem xét lại nếu wry cung cấp API native (rủi ro ghi nhận).
