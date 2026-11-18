# Phát hành

1. Cập nhật `version` ở ba nơi (phải giống nhau): `apps/desktop/package.json`, `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/tauri.conf.json`.
2. Đẩy tag: `git tag v0.0.2 && git push origin v0.0.2`.
3. Workflow `release.yml` build bộ cài NSIS, tạo release **công khai ngay** kèm `SHA256SUMS.txt`, rồi in danh sách tệp đã tải lên (step "Verify assets").
4. Tải về, kiểm tra SHA256 (`Get-FileHash`) và cài thử trên Windows. Bản cài **chưa ký số** nên SmartScreen sẽ cảnh báo.

`package-lock.json` và `Cargo.lock` đã được commit nên CI dùng `npm ci` và phiên bản crate cố định. Bộ cài dùng `icons/icon.ico` (khai báo trong `bundle.icon`); muốn có icon nhiều kích thước thì thêm PNG và cập nhật danh sách.

## Giới hạn đã biết
- Bộ cài **chưa được ký số**: Windows SmartScreen sẽ cảnh báo. Cần chứng chỉ code signing (quyết định của chủ dự án).
- **Chưa có cập nhật tự động.** Cần quyết định hạ tầng cập nhật và khóa ký trước khi làm.
- Bộ cài **không đóng gói WebView2 Runtime**. Ứng dụng kiểm tra runtime khi khởi động và ghi nhật ký nếu thiếu (xem `bytwina.log` trong thư mục dữ liệu ứng dụng).
- Nhật ký `bytwina.log` không ghi URL; xoay vòng ở 512 KB.
