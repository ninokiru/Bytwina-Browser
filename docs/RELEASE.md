# Phát hành

1. Chọn phiên bản theo SemVer `MAJOR.MINOR.PATCH`. Sửa lỗi và cập nhật nhỏ tăng **PATCH** (ví dụ `0.0.5` → `0.0.6`); tính năng tương thích mới tăng **MINOR**; chỉ thay đổi phá vỡ tương thích mới tăng **MAJOR**. Không cần tăng major cho mỗi bản phát hành.
2. Chạy workflow **Release** trong GitHub Actions và nhập `vX.Y.Z`. Workflow đồng bộ phiên bản vào `package.json`, `Cargo.toml`, `Cargo.lock` và `tauri.conf.json` trước khi build. Hoặc đẩy tag tương ứng sau khi cập nhật các file phiên bản.
3. Workflow `release.yml` build bộ cài NSIS, tạo release **công khai ngay** kèm `SHA256SUMS.txt`, rồi in danh sách tệp đã tải lên (step "Verify assets").
4. Tải về, kiểm tra SHA256 (`Get-FileHash`) và cài thử trên Windows. Bản cài **chưa ký số** nên SmartScreen sẽ cảnh báo.

`package-lock.json` và `Cargo.lock` đã được commit nên CI dùng `npm ci` và phiên bản crate cố định. Bộ cài dùng `icons/icon.ico` (khai báo trong `bundle.icon`); muốn có icon nhiều kích thước thì thêm PNG và cập nhật danh sách.

## Cập nhật tự động (M14)

Menu ⋮ → "Cập nhật Bytwina" hỏi `latest.json` của release mới nhất, rồi tải và cài tệp NSIS sau khi xác minh chữ ký minisign. Khoá công khai nằm trong `tauri.conf.json` → `plugins.updater.pubkey`; chỉ CI chèn, từ secret.

Một lần cho mỗi khoá (mất khoá = không bao giờ phát được bản mới cho máy đã cài):

1. Trên máy có toolchain: `cd apps/desktop && npx tauri signer generate -w ~/.tauri/bytwina.key` (đặt mật khẩu), lưu tệp khoá riêng tư an toàn, **không commit**.
2. GitHub → Settings → Secrets and variables → Actions, thêm:
   - `TAURI_UPDATER_PUBKEY` = nội dung `~/.tauri/bytwina.key.pub`
   - `TAURI_SIGNING_PRIVATE_KEY` = nội dung `~/.tauri/bytwina.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = mật khẩu đã đặt
3. Từ tag sau đó, release có thêm `latest.json`; bản đã cài tự thấy bản mới.

Thiếu secret: release vẫn tạo nhưng **không ký**, app bỏ qua bước cập nhật (không báo "đã mới nhất" sai). Bản đã ký chỉ nhận bản mới cũng có chữ ký đúng khoá.

## Giới hạn đã biết
- Bộ cài **chưa được ký số** (code signing): Windows SmartScreen sẽ cảnh báo. Chữ ký minisign ở trên chỉ chứng minh bản cập nhật đến từ bạn, không thay chứng chỉ code signing.
- Tự cập nhật cần 2 secret ở trên; nếu chưa cấu hình thì menu báo không kiểm tra được bản mới.
- Bộ cài **không đóng gói WebView2 Runtime**. Ứng dụng kiểm tra runtime khi khởi động và ghi nhật ký nếu thiếu (xem `bytwina.log` trong thư mục dữ liệu ứng dụng).
- Nhật ký `bytwina.log` không ghi URL; xoay vòng ở 512 KB.
