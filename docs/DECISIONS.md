# Quyết định kiến trúc (ADR)

## ADR-001: Dùng Window::add_child để đặt WebView2 native trong cửa sổ

- **Trạng thái:** Chấp nhận cho prototype M0; cần đánh giá lại trước production.
- **Bối cảnh:** Trình duyệt phải dùng WebView2 native, không dùng iframe.
- **Quyết định:** Dùng `tauri::Window::add_child(WebviewBuilder, position, size)`.
- **Rủi ro đã xác minh (docs.rs, Tauri 2.12.6):**
  - Hàm chỉ khả dụng với feature `unstable`. Prototype bật feature này trong `Cargo.toml`.
  - Trên Windows, hàm có thể deadlock nếu gọi từ command đồng bộ hoặc event handler. Mọi command gọi `add_child` phải là `async`.
- **Hệ quả:** Có thể bị thay đổi ở bản Tauri sau. Trước M1 cần quyết định giữ hay thay thế.
- **Phương án thay thế:** Tách trình duyệt thành cửa sổ/tiến trình riêng, hoặc dùng API WebView không thuộc Tauri (wry trực tiếp).
